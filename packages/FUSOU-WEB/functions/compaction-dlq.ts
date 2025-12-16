export default {
  async queue(batch: MessageBatch<any>) {
    for (const msg of batch.messages) {
      console.error("[Compaction DLQ] Received failed message", msg.body);
      msg.ack();
    }
  },
};
