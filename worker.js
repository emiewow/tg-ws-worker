import { connect } from "cloudflare:sockets";

async function toBytes(data) {
	if (data instanceof ArrayBuffer) {
		return new Uint8Array(data);
	}
	if (ArrayBuffer.isView(data)) {
		return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	}
	if (typeof data === "string") {
		return new TextEncoder().encode(data);
	}
	if (data && typeof data.arrayBuffer === "function") {
		return new Uint8Array(await data.arrayBuffer());
	}
	return new Uint8Array();
}

export default {
	async fetch(request, env, ctx) {
		const upgradeHeader = (request.headers.get("Upgrade") || "").toLowerCase();
		if (upgradeHeader !== "websocket") {
			return new Response("Telegram WebSocket Proxy Worker is running.\n", {
				status: 200,
				headers: { "Content-Type": "text/plain; charset=utf-8" },
			});
		}

		const url = new URL(request.url);
		if (url.pathname !== "/apiws") {
			return new Response("Not found", { status: 404 });
		}

		const dst = url.searchParams.get("dst");
		if (!dst) {
			return new Response("Missing dst", { status: 400 });
		}

		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];
		server.accept();

		let socket;
		try {
			socket = connect({ hostname: dst, port: 443 });
		} catch (err) {
			server.close(1011, "Connect failed: " + err.message);
			return new Response("Connect failed", { status: 502 });
		}

		const tcpReader = socket.readable.getReader();
		const tcpWriter = socket.writable.getWriter();

		server.addEventListener("message", async (event) => {
			try {
				const bytes = await toBytes(event.data);
				if (bytes.length > 0) {
					await tcpWriter.ready;
					await tcpWriter.write(bytes);
				}
			} catch {
				try {
					server.close(1011, "tcp write failed");
				} catch {}
			}
		});

		server.addEventListener("close", async () => {
			try {
				await tcpWriter.close();
			} catch {}
			try {
				socket.close();
			} catch {}
		});

		server.addEventListener("error", () => {
			try {
				socket.close();
			} catch {}
		});

		const pump = (async () => {
			try {
				while (true) {
					const { value, done } = await tcpReader.read();
					if (done) {
						break;
					}
					if (value && server.readyState === 1) {
						server.send(value);
					}
				}
			} catch {
			} finally {
				try {
					server.close();
				} catch {}
				try {
					tcpReader.releaseLock();
				} catch {}
				try {
					socket.close();
				} catch {}
			}
		})();

		if (ctx && ctx.waitUntil) {
			ctx.waitUntil(pump);
		}

		return new Response(null, { status: 101, webSocket: client });
	},
};
