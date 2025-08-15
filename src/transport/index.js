/**
 * @typedef {Object} Transport
 * @property {(data:any)=>void} send       json-serialisable outbound payload
 * @property {(code?:number, reason?:string)=>void} close
 * @property {(cb:(data:any)=>void)=>()=>void} onMessage  subscribe; returns unsubscribe fn
 * @property {(cb:(ev:{code:number,reason?:string})=>void)=>()=>void} onClose
 */
export { browserWSWithReconnect }     from "./ws/ws.js";
export { rtcInitiator, rtcResponder } from "./webrtc/index.js";

/* optional helper so callers can sanity-check */
export function isTransport(obj) {
  return obj
    && typeof obj.send      === "function"
    && typeof obj.onMessage === "function"
    && typeof obj.close     === "function";
}