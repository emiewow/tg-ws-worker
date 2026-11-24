import { connect } from "cloudflare:sockets";

/**
 * Преобразование входящих данных в Uint8Array для записи в TCP-сокет.
 */
async function toBytes(chunk) {
	if (chunk instanceof ArrayBuffer) {
		return new Uint8Array(chunk);
	}
	if (ArrayBuffer.isView(chunk)) {
		return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
	}
	if (chunk && typeof chunk.arrayBuffer === "function") {
		return new Uint8Array(await chunk.arrayBuffer());
	}
	if (typeof chunk === "string") {
		return new TextEncoder().encode(chunk);
	}
	return new Uint8Array();
}

/**
 * Создает ReadableStream из WebSocket сервера для потокового чтения
 */
function makeReadableWebSocketStream(wsServer) {
	let cancelled = false;
	return new ReadableStream({
		start(controller) {
			wsServer.addEventListener("message", (event) => {
				if (cancelled) return;
				controller.enqueue(event.data);
			});
			wsServer.addEventListener("close", () => {
				if (cancelled) return;
				try {
					controller.close();
				} catch {}
			});
			wsServer.addEventListener("error", (err) => {
				if (cancelled) return;
				try {
					controller.error(err);
				} catch {}
			});
		},
		cancel() {
			cancelled = true;
			try {
				if (wsServer.readyState === 1) {
					wsServer.close();
				}
			} catch {}
		},
	});
}

export default {
	async fetch(request, env, ctx) {
		const upgradeHeader = request.headers.get("Upgrade") || "";
		if (upgradeHeader.toLowerCase() !== "websocket") {
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
			return new Response("Missing dst parameter", { status: 400 });
		}

		// Создаем WebSocket пару
		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];

		// Явно задаем arraybuffer для бинарных сообщений
		server.binaryType = "arraybuffer";
		server.accept();

		// Устанавливаем прямое TCP соединение с дата-центром Telegram
		let socket;
		try {
			socket = connect({ hostname: dst, port: 443 });
		} catch (err) {
			server.close(1011, "Connect failed: " + err.message);
			return new Response("Connect failed", { status: 502 });
		}

		const safeClose = () => {
			try {
				if (server.readyState === 1) {
					server.close();
				}
			} catch {}
			try {
				socket.close();
			} catch {}
		};

		// Поток 1: Клиент (WebSocket) -> Telegram DC (TCP)
		const wsStream = makeReadableWebSocketStream(server);
		const toUint8Transform = new TransformStream({
			async transform(chunk, controller) {
				const bytes = await toBytes(chunk);
				if (bytes.byteLength > 0) {
					controller.enqueue(bytes);
				}
			},
		});

		const clientToTelegram = wsStream
			.pipeThrough(toUint8Transform)
			.pipeTo(socket.writable)
			.catch(() => safeClose());

		// Поток 2: Telegram DC (TCP) -> Клиент (WebSocket)
		const telegramToClient = socket.readable
			.pipeTo(
				new WritableStream({
					write(chunk) {
						if (server.readyState === 1) {
							server.send(chunk);
						}
					},
					close() {
						safeClose();
					},
					abort() {
						safeClose();
					},
				})
			)
			.catch(() => safeClose());

		// ctx.waitUntil держит воркер активным в Cloudflare и предотвращает тайм-аут через 15 секунд
		ctx.waitUntil(Promise.allSettled([clientToTelegram, telegramToClient]));

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	},
};
