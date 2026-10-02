export async function readApiResponse(response:Response):Promise<Record<string,unknown>>{
 let value:unknown;
 try{value=await response.json()}catch{
  throw Object.assign(new Error('伺服器回應中斷，請稍後重試。已儲存的資料不會因此清除。'),{status:response.ok?502:response.status,code:'invalid_response'});
 }
 if(!response.ok)throw Object.assign(new Error(value&&typeof value==='object'&&'error'in value&&typeof value.error==='string'?value.error:'操作失敗，請重試'),{status:response.status});
 if(!value||typeof value!=='object'||Array.isArray(value))throw Object.assign(new Error('伺服器回應格式異常，請稍後重試。'),{status:502,code:'invalid_response'});
 return value as Record<string,unknown>;
}
