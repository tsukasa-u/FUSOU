import {
  deserializeLocalBattleError,
  LocalBattleError,
  serializeLocalBattleError,
  type WorkerRequest,
  type WorkerResponse,
} from "./protocol";
import { LocalWorkerSession } from "./session";

const session = new LocalWorkerSession();
const workerScope = self as unknown as {
  postMessage: (response: WorkerResponse) => void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

function send(response: WorkerResponse): void {
  workerScope.postMessage(response);
}

workerScope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  void (async () => {
    try {
      if (request.type === "initialize") {
        send({ id: request.id, type: "result", value: session.initialize(request.manifest) });
        return;
      }
      if (request.type === "cancel") {
        session.cancel(request.targetId);
        send({ id: request.targetId, type: "cancelled" });
        return;
      }
      if (request.type === "dispose") {
        session.dispose();
        send({ id: request.id, type: "result", value: {} });
        return;
      }
      if (request.type === "list-periods") {
        send({ id: request.id, type: "result", value: session.listPeriods(request.table) });
        return;
      }
      if (request.type === "records") {
        const value = await session.records(request.id, request.query, (phase, completed, total, label, details) => {
          send({ id: request.id, type: "progress", phase, completed, total, ...(label === undefined ? {} : { label }), ...details });
        });
        send({ id: request.id, type: "result", value });
        return;
      }
      if (request.type === "overview") {
        const value = await session.overview(request.id, request.query, (phase, completed, total, label, details) => {
          send({ id: request.id, type: "progress", phase, completed, total, ...(label === undefined ? {} : { label }), ...details });
        });
        send({ id: request.id, type: "result", value });
        return;
      }
      if (request.type === "drops") {
        const value = await session.drops(request.id, request.query, (phase, completed, total, label, details) => {
          send({ id: request.id, type: "progress", phase, completed, total, ...(label === undefined ? {} : { label }), ...details });
        });
        send({ id: request.id, type: "result", value });
        return;
      }
      if (request.type === "detail") {
        const value = await session.detail(request.id, request.query, (phase, completed, total, label, details) => {
          send({ id: request.id, type: "progress", phase, completed, total, ...(label === undefined ? {} : { label }), ...details });
        });
        send({ id: request.id, type: "result", value });
        return;
      }
      throw new LocalBattleError("BATTLE_NOT_FOUND", "この local AVRO query はまだ利用できません。");
    } catch (error) {
      const localError = error instanceof LocalBattleError ? error : deserializeLocalBattleError(serializeLocalBattleError(error));
      if (localError.code === "CANCELLED") {
        send({ id: request.id, type: "cancelled" });
        return;
      }
      send({ id: request.id, type: "error", error: serializeLocalBattleError(localError) });
    }
  })();
};