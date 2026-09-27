import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import webpush from 'npm:web-push@3.6.7';

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', {status:405});
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const authorization = request.headers.get('Authorization') ?? '';
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {global:{headers:{Authorization:authorization}}});
    const {data:{user},error:authError} = await caller.auth.getUser();
    if (authError || !user) return new Response('Unauthorized',{status:401});
    const {taskId} = await request.json();
    if (typeof taskId !== 'string') return new Response('Task required',{status:400});
    const {data:task,error} = await caller.from('tasks').select('id,employee_id,created_by,created_at,title,due_at,assigned_by_name,assigned_by_role,completed_at').eq('id',taskId).single();
    if (error || !task || task.created_by !== user.id || task.completed_at || Date.now()-Date.parse(task.created_at)>300000) return new Response('Task unavailable',{status:403});
    const admin = createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const {data:credentials,error:credentialsError} = await admin.rpc('task_push_credentials');
    if (credentialsError || !credentials) return Response.json({error:'Push setup is not ready.'},{status:503});
    const {data:subscriptions,error:subscriptionError} = await admin.rpc('task_push_recipients',{target_employee:task.employee_id});
    if (subscriptionError) throw subscriptionError;
    if (!subscriptions?.length) return Response.json({sent:0,reason:'Employee has not enabled phone notifications.'});
    const {data:claimed,error:claimError} = await admin.rpc('claim_task_push',{target_task:task.id});
    if (claimError) throw claimError;
    if (!claimed) return Response.json({sent:0,reason:'Notification already attempted.'});
    webpush.setVapidDetails('https://staffrecords.net',credentials.publicKey,credentials.privateKey);
    let sent=0;
    const payload=JSON.stringify({title:`Task from ${task.assigned_by_name ?? 'Manager'} (${task.assigned_by_role ?? 'manager'})`,body:`${task.title} — due ${new Date(task.due_at).toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg',hour:'2-digit',minute:'2-digit',day:'numeric',month:'short'})}`,taskId:task.id});
    await Promise.all(subscriptions.map(async (s: {id:string;endpoint:string;p256dh:string;auth:string}) => {
      try {
        const endpoint=new URL(s.endpoint);
        if (endpoint.protocol!=='https:' || endpoint.port || endpoint.username || endpoint.password || !['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].some(host=>endpoint.hostname===host || endpoint.hostname.endsWith('.'+host))) return;
        await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth}},payload,{TTL:86400,timeout:10000});
        sent++;
      } catch (error) {
        const code=(error as {statusCode?:number}).statusCode;
        if (code===404 || code===410) await admin.from('task_push_subscriptions').delete().eq('id',s.id);
      }
    }));
    return Response.json({sent,reason:sent ? undefined : 'Phone alert could not be delivered. The task is saved in the inbox.'});
  } catch { return Response.json({error:'Phone alert could not be delivered. The task remains in the inbox.'},{status:500}); }
});
