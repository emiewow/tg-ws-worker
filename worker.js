import { connect } from "cloudflare:sockets";

/**
 * Преобразование входящих данных любого формата (ArrayBuffer, Uint8Array, string, Blob)
 * в типизированный байтовый массив Uint8Array для записи в TCP-сокет.
 */
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
	async fetch(request) {
		// Проверка протокола WebSocket
		if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
			return new Response("Expected websocket", { status: 426 });
		}

		const url = new URL(request.url);
		if (url.pathname !== "/apiws") {
			return new Response("Not found", { status: 404 });
		}

		const dst = url.searchParams.get("dst");
		if (!dst) {
			return new Response("Missing dst", { status: 400 });
		}

		// Создаем пару сокетов WebSocket
		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];
		server.accept();

		// Устанавливаем прямое TCP-соединение с дата-центром Telegram на порт 443
		const socket = connect({ hostname: dst, port: 443 });
		const tcpReader = socket.readable.getReader();
		const tcpWriter = socket.writable.getWriter();

		// Очередь для последовательной записи в TCP-сокет
		// Предотвращает ошибку коллизии параллельных записей при загрузке/скачивании тяжелых медиа
		let writeQueue = Promise.resolve();

		server.addEventListener("message", (event) => {
			writeQueue = writeQueue.then(async () => {
				const bytes = await toBytes(event.data);
				if (bytes.length > 0) {
					await tcpWriter.write(bytes);
				}
			}).catch(() => {
				try {
					server.close(1011, "tcp write failed");
				} catch {}
				try {
					socket.close();
				} catch {}
			});
		});

		server.addEventListener("close", async () => {
			try {
				await writeQueue;
			} catch {}
			try {
				await tcpWriter.close();
			} catch {}
			try {
				socket.close();
			} catch {}
		});

		// Чтение входящего потока от Telegram DC и отправка клиенту через WebSocket
		(async () => {
			try {
				while (true) {
					const { value, done } = await tcpReader.read();
					if (done) {
						break;
					}
					if (value) {
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

		return new Response(null, { status: 101, webSocket: client });
	},
};
