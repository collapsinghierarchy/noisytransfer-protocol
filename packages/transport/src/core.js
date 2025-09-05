/**
 * @typedef {Object} Transport
 * @property {(data:any)=>void} send
 * @property {(code?:number, reason?:string)=>void} close
 * @property {(cb:(data:any)=>void)=>()=>void} onMessage
 * @property {(cb:(ev:{code:number,reason?:string})=>void)=>()=>void} onClose
 */
export function isTransport(obj) {
  return (
    obj &&
    typeof obj.send === "function" &&
    typeof obj.onMessage === "function" &&
    typeof obj.close === "function"
  );
}
