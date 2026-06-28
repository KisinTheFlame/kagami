/**
 * Events consumed by StoryLoopAgent's event queue.
 *
 * ledger_appended — pushed by LinearMessageLedgerAgentContext whenever the
 *                   root agent writes new messages to the message ledger.
 *                   Tells the story agent "there may be new batch material,
 *                   re-check the ledger".
 *
 * wake             — pure wake marker. Pushed by stop(), reset(), and any
 *                   internal timers. Carries no information; the event's
 *                   arrival IS the signal.
 */
export type StoryAgentEvent = { type: "ledger_appended"; count: number } | { type: "wake" };
