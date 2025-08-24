import { STATES, nextState, classifyTransportClose } from "./states.js";

/** Pure FSM facade (auth-only) for logging/tests */
export class ReceiverFsm {
  constructor(send, opts = {}) {
     this.send = send;
     this.state = STATES.IDLE;
     this.onTransition = opts.onTransition;
   }
  transportClosed() { return classifyTransportClose(this.state); }

  start()       { this.#adv("start"); }
  roomFull()    { this.#adv("room_full"); }
  commit()      { this.#adv("commit"); }
  offer()       { this.#adv("offer"); }
  reveal()      { this.#adv("reveal"); }
  rcvconfirm()  { this.#adv("rcvconfirm"); }

  error()       { this.#adv("error"); }
  rejected()    { this.#adv("rejected"); }
  vrfyFail()    { this.#adv("vrfyFail"); }

  #adv(evt){ 
    this.state = nextState("Receiver", this.state, evt);
    this.onTransition?.({ role:"receiver", from: this.state, ev: evt, to: this.state });
  }
}