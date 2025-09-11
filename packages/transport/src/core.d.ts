/**
 * @typedef {Object} Transport
 * @property {(data:any)=>void} send
 * @property {(code?:number, reason?:string)=>void} close
 * @property {(cb:(data:any)=>void)=>()=>void} onMessage
 * @property {(cb:(ev:{code:number,reason?:string})=>void)=>()=>void} onClose
 */
export function isTransport(obj: any): boolean;
export type Transport = {
    send: (data: any) => void;
    close: (code?: number, reason?: string) => void;
    onMessage: (cb: (data: any) => void) => () => void;
    onClose: (cb: (ev: {
        code: number;
        reason?: string;
    }) => void) => () => void;
};
