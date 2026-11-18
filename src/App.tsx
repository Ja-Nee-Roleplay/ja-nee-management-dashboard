import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { Activity, ArrowLeft, ArrowRight, Bell, CalendarDays, Check, CheckCircle2, ChevronDown, CircleAlert, ExternalLink, Filter, GitBranch, LayoutDashboard, Link2, ListTodo, LogOut, Menu, MessageCircle, Milestone, MoreHorizontal, Plus, Search, Settings as SettingsIcon, ShieldCheck, Trash2, Users, X, Zap } from "lucide-react";
import { getAuthRedirectUrl, isSupabaseConfigured, supabase } from "./lib/supabase";

const TODAY = new Date();
type Priority = "Low" | "Medium" | "High" | "Urgent";
type Page = "Overview" | "Task board" | "Roadmaps" | "Calendar" | "Announcements" | "Activity log" | "Members" | "Resources" | "Settings";
type Member = { id:string; name:string; handle:string; role:string; color:string; status:string; avatarUrl?:string };
type Column = { id:string; title:string; color:string };
type Task = { id:string; title:string; description:string; columnId:string; priority:Priority; tags:string[]; assignees:string[]; dueDate:string; checklist:{id:string;text:string;done:boolean}[]; comments:{id:string;text:string;author:string;createdAt?:string}[]; createdAt:string; updatedAt:string; completedAt?:string };
type Roadmap = { id:string; title:string; category:string; progress:number; target:string; priority:Priority };
type Announcement = { id:string; title:string; body:string; pinned:boolean; category:string; date:string; author?:string };
type Resource = { id:string; title:string; url:string; description:string; category:string };
type WorkspaceTag = { id:string; name:string; color:string };
type EventItem = { id:string; text:string; actor:string; date:string };
type Store = { workspace:string; logoUrl:string; accent:string; theme:string; completedTaskRetentionDays:number; columns:Column[]; tasks:Task[]; members:Member[]; roadmaps:Roadmap[]; announcements:Announcement[]; resources:Resource[]; tags:WorkspaceTag[]; events:EventItem[]; widgets:Record<string,boolean> };
type WorkspaceProfile = { id:string; display_name:string; username:string|null; avatar_url:string|null; role:string; approved:boolean };
type AuthProvider = "github";
const uid=()=>Math.random().toString(36).slice(2,10);
const seed=(profile:WorkspaceProfile):Store=>{
 const profileName=profile.display_name||profile.username||"Member";
 const members:Member[]=[{id:profile.id,name:profileName,handle:profile.username?"@"+profile.username:"@"+profileName.replace(/\s+/g,""),role:profile.role,color:"#587d4a",status:"Online",avatarUrl:profile.avatar_url??undefined}];
 const columns:Column[]=[{id:"backlog",title:"Backlog",color:"#7d8792"},{id:"todo",title:"To do",color:"#88954a"},{id:"doing",title:"In progress",color:"#75a252"},{id:"review",title:"Under review",color:"#a78753"},{id:"done",title:"Completed",color:"#4e956b"}];
 return {workspace:"Ja-Nee Management",logoUrl:"",accent:"#165209",theme:"dark",completedTaskRetentionDays:0,columns,tasks:[],members,
  roadmaps:[],announcements:[],resources:[],tags:[],events:[],widgets:{deadlines:true,activity:true,roadmap:true,members:true}};
};
function normalizeStore(value:unknown,profile:WorkspaceProfile):Store{
 const blank=seed(profile);
 if(!value||typeof value!=="object")return blank;
 const store=value as Partial<Store>;
 const tasks=Array.isArray(store.tasks)?store.tasks.map(task=>({...task,tags:Array.isArray(task.tags)?task.tags:[],assignees:Array.isArray(task.assignees)?task.assignees:[],checklist:Array.isArray(task.checklist)?task.checklist:[],comments:Array.isArray(task.comments)?task.comments.filter(comment=>comment&&typeof comment.text==="string").map((comment,index)=>({...comment,id:comment.id||`legacy-${task.id}-${index}`,author:comment.author||"Team member"})):[],completedAt:typeof task.completedAt==="string"?task.completedAt:undefined})):[];
 const tags=Array.isArray(store.tags)?store.tags.filter(tag=>tag&&typeof tag.name==="string").map(tag=>({id:tag.id||"legacy-"+tag.name.toLowerCase(),name:tag.name,color:tag.color||"#75a252"})):[];
 const known=new Set(tags.map(tag=>tag.name.toLowerCase()));
 for(const name of new Set(tasks.flatMap(task=>Array.isArray(task.tags)?task.tags:[]))){if(name&&!known.has(name.toLowerCase())){tags.push({id:"legacy-"+name.toLowerCase(),name,color:"#75a252"});known.add(name.toLowerCase())}}
 const retentionOptions=[0,1,3,7,14,30,60,90];
 return {...blank,...store,logoUrl:typeof store.logoUrl==="string"?store.logoUrl:"",completedTaskRetentionDays:retentionOptions.includes(Number(store.completedTaskRetentionDays))?Number(store.completedTaskRetentionDays):0,columns:Array.isArray(store.columns)&&store.columns.length?store.columns:blank.columns,tasks,members:Array.isArray(store.members)?store.members:blank.members,roadmaps:Array.isArray(store.roadmaps)?store.roadmaps:[],announcements:Array.isArray(store.announcements)?store.announcements:[],resources:Array.isArray(store.resources)?store.resources:[],tags,events:Array.isArray(store.events)?store.events:[],widgets:store.widgets&&typeof store.widgets==="object"?store.widgets:blank.widgets};
}
function mergeLocalWorkspaceChanges(base:Store,local:Store,remote:Store):Store{
 const merged={...remote};
 const baseRecord=base as unknown as Record<string,unknown>;const localRecord=local as unknown as Record<string,unknown>;const remoteRecord=remote as unknown as Record<string,unknown>;const mergedRecord=merged as unknown as Record<string,unknown>;
 const collections=["tasks","columns","roadmaps","announcements","resources","tags","events"] as const;
 for(const key of collections){
  const before=(baseRecord[key] as {id:string}[]|undefined)??[];const current=(localRecord[key] as {id:string}[]|undefined)??[];const latest=(remoteRecord[key] as {id:string}[]|undefined)??[];
  const beforeById=new Map(before.map(item=>[item.id,item]));const currentById=new Map(current.map(item=>[item.id,item]));const latestById=new Map(latest.map(item=>[item.id,item]));
  for(const item of before)if(!currentById.has(item.id))latestById.delete(item.id);
  for(const item of current){const original=beforeById.get(item.id);if(!original){latestById.set(item.id,item);continue}if(JSON.stringify(original)===JSON.stringify(item))continue;const remoteItem=latestById.get(item.id);if(key==="tasks"&&!remoteItem)continue;if(key==="tasks"&&remoteItem){const beforeTask=original as Task;const localTask=item as Task;const remoteTask=remoteItem as Task;const mergedTask={...remoteTask};for(const field of Object.keys(localTask) as (keyof Task)[])if(JSON.stringify(beforeTask[field])!==JSON.stringify(localTask[field]))(mergedTask as unknown as Record<string,unknown>)[field]=localTask[field];const commentMap=new Map<string,Task["comments"][number]>();for(const comment of [...(remoteTask.comments??[]),...(localTask.comments??[])])commentMap.set(comment.id,comment);mergedTask.comments=[...commentMap.values()].sort((a,b)=>(a.createdAt??"").localeCompare(b.createdAt??""));latestById.set(item.id,mergedTask)}else latestById.set(item.id,item)}
  let items=[...latestById.values()];
  if(key==="tasks"&&JSON.stringify(before.map(item=>item.id))!==JSON.stringify(current.map(item=>item.id))){const order=new Map(current.map((item,index)=>[item.id,index]));items.sort((a,b)=>(order.get(a.id)??Number.MAX_SAFE_INTEGER)-(order.get(b.id)??Number.MAX_SAFE_INTEGER))}
  mergedRecord[key]=items;
 }
 const scalarKeys=["workspace","logoUrl","accent","theme","completedTaskRetentionDays"];
 for(const key of scalarKeys)if(JSON.stringify(baseRecord[key])!==JSON.stringify(localRecord[key]))mergedRecord[key]=localRecord[key];
 if(JSON.stringify(base.widgets)!==JSON.stringify(local.widgets)){const widgets={...remote.widgets};for(const [key,value] of Object.entries(local.widgets))if(base.widgets[key]!==value)widgets[key]=value;merged.widgets=widgets}
 return merged;
}
type ChangeNotice={entity:string;action:"created"|"updated"|"deleted";title:string;detail?:string;assigneeIds:string[]};
function changesBetween(before:Store,after:Store):ChangeNotice[]{
 const changes:ChangeNotice[]=[];
 const compare=<T extends {id:string}>(oldItems:T[],newItems:T[],entity:string,title:(item:T)=>string,assignees?:(item:T)=>string[],detail?:(oldItem:T|undefined,newItem:T|undefined,action:"created"|"updated"|"deleted")=>string)=>{
  const oldById=new Map(oldItems.map(item=>[item.id,item]));const newById=new Map(newItems.map(item=>[item.id,item]));
  for(const [id,item] of newById){const previous=oldById.get(id);if(previous&&JSON.stringify(previous)===JSON.stringify(item))continue;const action=previous?"updated":"created";changes.push({entity,action,title:title(item),detail:detail?.(previous,item,action),assigneeIds:assignees?.(item)??[]})}
  for(const [id,item] of oldById)if(!newById.has(id))changes.push({entity,action:"deleted",title:title(item),detail:detail?.(item,undefined,"deleted"),assigneeIds:assignees?.(item)??[]});
 };
 const status=(id:string,store:Store)=>store.columns.find(column=>column.id===id)?.title??"Unknown";
 compare(before.tasks,after.tasks,"task",item=>item.title,item=>item.assignees,(oldTask,newTask,action)=>{
  if(action==="created"&&newTask)return `Status: ${status(newTask.columnId,after)} · Priority: ${newTask.priority}`;
  if(action==="deleted"&&oldTask)return `Removed from ${status(oldTask.columnId,before)}.`;
  if(!oldTask||!newTask)return "Task details updated.";
  const details:string[]=[];
  if(oldTask.columnId!==newTask.columnId)details.push(`Status: ${status(oldTask.columnId,before)} → ${status(newTask.columnId,after)}`);
  if(oldTask.priority!==newTask.priority)details.push(`Priority: ${oldTask.priority} → ${newTask.priority}`);
  if(oldTask.dueDate!==newTask.dueDate)details.push(newTask.dueDate?`Due date: ${newTask.dueDate}`:"Due date removed");
  if(JSON.stringify(oldTask.assignees)!==JSON.stringify(newTask.assignees))details.push("Assignees updated");
  if(JSON.stringify(oldTask.comments)!==JSON.stringify(newTask.comments))details.push("Discussion updated");
  if(JSON.stringify(oldTask.checklist)!==JSON.stringify(newTask.checklist))details.push("Checklist updated");
  if(oldTask.description!==newTask.description)details.push("Description updated");
  if(JSON.stringify(oldTask.tags)!==JSON.stringify(newTask.tags))details.push("Tags updated");
  return details.join(" · ")||"Task details updated.";
 });
 compare(before.roadmaps,after.roadmaps,"roadmap",item=>item.title);
 compare(before.announcements,after.announcements,"announcement",item=>item.title);
 compare(before.resources,after.resources,"resource",item=>item.title);
 compare(before.tags,after.tags,"tag",item=>item.name);
 compare(before.columns,after.columns,"board column",item=>item.title);
 if(before.workspace!==after.workspace||before.logoUrl!==after.logoUrl||before.accent!==after.accent||before.theme!==after.theme||before.completedTaskRetentionDays!==after.completedTaskRetentionDays||JSON.stringify(before.widgets)!==JSON.stringify(after.widgets))changes.push({entity:"workspace settings",action:"updated",title:after.workspace||"Workspace",detail:before.logoUrl!==after.logoUrl?"Workspace logo updated.":"Workspace appearance or dashboard preferences updated.",assigneeIds:[]});
 return changes;
}
const initials=(s:string)=>s.split(" ").map(x=>x[0]).slice(0,2).join("").toUpperCase();
const fmt=(s:string)=>s?new Date(s+"T12:00:00").toLocaleDateString("en-ZA",{day:"numeric",month:"short"}):"No date";
const timeAgo=(s:string)=>{const n=Math.max(1,Math.floor((Date.now()-new Date(s).getTime())/60000));return n<60?n+"m ago":n<1440?Math.floor(n/60)+"h ago":Math.floor(n/1440)+"d ago"};
const late=(s:string)=>!!s&&s<new Date().toISOString().slice(0,10);
const prio:Record<Priority,number>={Urgent:0,High:1,Medium:2,Low:3};
const nav:{name:Page;icon:typeof LayoutDashboard}[]=[{name:"Overview",icon:LayoutDashboard},{name:"Task board",icon:ListTodo},{name:"Roadmaps",icon:Milestone},{name:"Calendar",icon:CalendarDays},{name:"Announcements",icon:MessageCircle},{name:"Activity log",icon:Activity},{name:"Members",icon:Users},{name:"Resources",icon:Link2},{name:"Settings",icon:SettingsIcon}];

type AuthView={loading:boolean;user:User|null;profile:WorkspaceProfile|null;error:string|null};
type WorkspaceRow={data:unknown;updated_by_client:string|null};
const memberColors=["#587d4a","#6c829e","#a87856","#846b9d","#567d80"];
const roleName=(role:string)=>({owner:"Owner",administrator:"Administrator",management:"Management",developer:"Developer",viewer:"Viewer"}[role]??"Member");
function asMember(profile:WorkspaceProfile,index:number):Member{
 const name=profile.display_name||profile.username||"Member";
 return{id:profile.id,name,handle:profile.username?"@"+profile.username:"@"+name.replace(/\s+/g,""),role:roleName(profile.role),color:memberColors[index%memberColors.length],status:"Offline",avatarUrl:profile.avatar_url??undefined};
}
function BrandLogo({src}:{src?:string}){return <span className={"logo "+(src?"logo-image":"")}>{src?<img src={src} alt="Workspace logo"/>:<>JN<i/></>}</span>}
function Gate({title,children}:{title:string;children:React.ReactNode}){return <main className="auth-page"><section className="auth-card"><aside className="auth-side"><div className="auth-brand"><BrandLogo/><span><b>ja-nee</b><small>MANAGEMENT</small></span></div><div className="auth-art"><span className="auth-orbit orbit-one"/><span className="auth-orbit orbit-two"/><span className="auth-orbit orbit-three"/><div className="auth-art-mark"><LayoutDashboard size={34}/></div></div><div className="auth-side-copy"><small>ONE SHARED WORKSPACE</small><h2>Good work,<br/>in one place.</h2><p>Plan projects, keep your team aligned, and see progress as it happens.</p></div><span className="auth-side-footer">JA-NEE TEAM · PRIVATE WORKSPACE</span></aside><div className="auth-content"><div className="auth-mobile-brand"><BrandLogo/><b>ja-nee</b></div><small className="auth-eyebrow">JA-NEE TEAM WORKSPACE</small><h1>{title}</h1>{children}</div></section></main>}
function SignIn({onSignIn}:{onSignIn:(provider:AuthProvider)=>Promise<string|null>}){
 const [busy,setBusy]=useState<AuthProvider|null>(null);const [error,setError]=useState("");
 const start=async()=>{setBusy("github");setError("");const message=await onSignIn("github");if(message){setError(message);setBusy(null)}};
 return <Gate title="Welcome back"><p className="auth-copy">Sign in with the GitHub account approved for your Ja-Nee workspace.</p><button className="auth-provider" disabled={!!busy} onClick={()=>void start()}><GitBranch size={18}/>{busy?"Connecting to GitHub…":"Continue with GitHub"}<ArrowRight className="auth-button-arrow" size={16}/></button>{error&&<p className="auth-error">{error}</p>}<div className="auth-secure"><ShieldCheck size={15}/><span>Shared team data is protected by Supabase.</span></div><small className="auth-footnote">New accounts need owner approval before opening the workspace.</small></Gate>
}
export default function App(){
 const [auth,setAuth]=useState<AuthView>({loading:true,user:null,profile:null,error:null});
 const [workspace,setWorkspace]=useState<{data:Store;exists:boolean}|null>(null);
 const [workspaceError,setWorkspaceError]=useState("");
 useEffect(()=>{
  if(!supabase)return;
  const client=supabase;
  let alive=true;
  let activeUserId:string|null=null;
  const resolve=async(user:User|null)=>{
   if(!user){activeUserId=null;if(alive){setAuth({loading:false,user:null,profile:null,error:null});setWorkspace(null);setWorkspaceError("")}return}
   activeUserId=user.id;
   if(alive)setAuth({loading:true,user,profile:null,error:null});
   const {data,error}=await client.from("profiles").select("id,display_name,username,avatar_url,role,approved").eq("id",user.id).maybeSingle();
   if(!alive)return;
   if(error){activeUserId=null;setAuth({loading:false,user,profile:null,error:"Could not read your profile. Apply the database setup SQL, then reload."});return}
   if(!data){activeUserId=null;setAuth({loading:false,user,profile:null,error:"Your account profile was not created. Apply the database setup SQL, then sign in again."});return}
   setAuth({loading:false,user,profile:data as WorkspaceProfile,error:null});
  };
  const {data:{subscription}}=client.auth.onAuthStateChange((event,session)=>{
   const nextUser=session?.user??null;
   if(nextUser&&activeUserId===nextUser.id&&(event==="TOKEN_REFRESHED"||event==="SIGNED_IN")){setAuth(current=>current.user?.id===nextUser.id?{...current,user:nextUser}:current);return}
   void resolve(nextUser);
  });
  void client.auth.getSession().then(({data,error})=>{if(error&&alive)setAuth({loading:false,user:null,profile:null,error:error.message});else void resolve(data.session?.user??null)});
  return()=>{alive=false;subscription.unsubscribe()};
 },[]);
 useEffect(()=>{
  const currentProfile=auth.profile;
  if(!supabase||!currentProfile?.approved)return;
  let alive=true;
  void (async()=>{
   setWorkspaceError("");
   const [stateResult,profilesResult]=await Promise.all([
    supabase.from("workspace_state").select("data,updated_by_client").eq("id","main").maybeSingle(),
    supabase.from("profiles").select("id,display_name,username,avatar_url,role,approved").eq("approved",true).order("created_at")
   ]);
   if(!alive)return;
   if(stateResult.error){setWorkspaceError("Could not load the shared workspace: "+stateResult.error.message);return}
   if(profilesResult.error){setWorkspaceError("Could not load the approved member list: "+profilesResult.error.message);return}
   const people=(profilesResult.data??[]) as WorkspaceProfile[];
    const members=people.map(asMember);
    if(!members.some(member=>member.id===currentProfile.id))members.unshift(asMember(currentProfile,0));
    const baseline=seed(currentProfile);
    const loaded=normalizeStore(stateResult.data?.data??baseline,currentProfile);
   loaded.members=members;
   setWorkspace({data:loaded,exists:!!stateResult.data});
  })();
  return()=>{alive=false};
 },[auth.profile]);
 const signIn=async(provider:AuthProvider)=>{
  if(!supabase)return "Supabase is not configured yet.";
  const {error}=await supabase.auth.signInWithOAuth({provider,options:{redirectTo:getAuthRedirectUrl()}});
  return error?.message??null;
 };
 const signOut=async()=>{if(supabase)await supabase.auth.signOut()};
 if(!isSupabaseConfigured)return <Gate title="Connect the workspace database"><p className="auth-copy">Add the Supabase project URL and publishable key to the local environment and GitHub Actions variables. The demo content has been removed; the dashboard will open after the database and sign-in providers are configured.</p><div className="setup-code">VITE_SUPABASE_URL<br/>VITE_SUPABASE_PUBLISHABLE_KEY</div><small className="auth-footnote">Follow the Supabase setup steps in the project README.</small></Gate>;
 if(auth.loading)return <Gate title="Checking your sign-in"><p className="auth-copy">Loading your workspace access…</p></Gate>;
 if(auth.error)return <Gate title="Sign-in setup needs attention"><p className="auth-error">{auth.error}</p><button className="auth-provider secondary" onClick={()=>window.location.reload()}>Try again</button></Gate>;
 if(!auth.user)return <SignIn onSignIn={signIn}/>;
 if(!auth.profile)return <Gate title="Profile not found"><p className="auth-error">This login has no dashboard profile. Confirm that the Supabase setup SQL created the profile trigger.</p><button className="auth-provider secondary" onClick={()=>void signOut()}>Sign out</button></Gate>;
 if(!auth.profile.approved)return <Gate title="Waiting for owner approval"><p className="auth-copy">You’re signed in as <b>{auth.profile.display_name||auth.user.email}</b>. An owner must approve this account in Supabase before workspace data is available.</p><button className="auth-provider secondary" onClick={()=>void signOut()}>Sign out</button></Gate>;
 if(workspaceError)return <Gate title="Database setup needs attention"><p className="auth-error">{workspaceError}</p><button className="auth-provider secondary" onClick={()=>window.location.reload()}>Try again</button></Gate>;
 if(!workspace)return <Gate title="Loading shared workspace"><p className="auth-copy">Connecting to the Ja-Nee database…</p></Gate>;
 return <Dashboard key={auth.user.id} user={auth.user} profile={auth.profile} initialData={workspace.data} workspaceExists={workspace.exists} onSignOut={signOut}/>;
}

function Dashboard({user,profile,initialData,workspaceExists,onSignOut}:{user:User;profile:WorkspaceProfile;initialData:Store;workspaceExists:boolean;onSignOut:()=>Promise<void>}){
 const pageStorageKey=`ja-nee-dashboard:${user.id}:page`;const taskStorageKey=`ja-nee-dashboard:${user.id}:task`;
 const [data,setData]=useState<Store>(initialData);const [page,setPage]=useState<Page>(()=>{try{const saved=sessionStorage.getItem(pageStorageKey);return nav.some(item=>item.name===saved)?saved as Page:"Overview"}catch{return"Overview"}});const [query,setQuery]=useState("");const [taskId,setTaskId]=useState<string|null>(()=>{try{return sessionStorage.getItem(taskStorageKey)}catch{return null}});const [creating,setCreating]=useState(false);const [filter,setFilter]=useState("All priorities");const [assigneeFilter,setAssigneeFilter]=useState("Everyone");const [sort,setSort]=useState("Manual");const [drag,setDrag]=useState<string|null>(null);const [toast,setToast]=useState("");const [menu,setMenu]=useState(false);const [collapsed,setCollapsed]=useState(false);const [mobile,setMobile]=useState(false);const [syncStatus,setSyncStatus]=useState<"saved"|"saving"|"error">("saved");
 const clientId=useRef(uid());const savedSnapshot=useRef(workspaceExists?JSON.stringify(initialData):"");const remoteSnapshot=useRef<string|null>(null);const membersRef=useRef(data.members);const currentData=useRef(data);const savedData=useRef<Store|null>(workspaceExists?initialData:null);const [onlineProfileIds,setOnlineProfileIds]=useState<string[]>([]);const notificationWarningShown=useRef(false);
 useEffect(()=>{try{sessionStorage.setItem(pageStorageKey,page)}catch{}},[page,pageStorageKey]);
 useEffect(()=>{try{if(taskId)sessionStorage.setItem(taskStorageKey,taskId);else sessionStorage.removeItem(taskStorageKey)}catch{}},[taskId,taskStorageKey]);
 useEffect(()=>{if(taskId&&!data.tasks.some(task=>task.id===taskId)){setTaskId(null);setCreating(false)}},[data.tasks,taskId]);
 useEffect(()=>{membersRef.current=data.members;currentData.current=data},[data]);
 useEffect(()=>{
  const snapshot=JSON.stringify(data);
  if(snapshot===savedSnapshot.current)return;
  if(snapshot===remoteSnapshot.current){savedSnapshot.current=snapshot;remoteSnapshot.current=null;return}
  setSyncStatus("saving");
  const timer=setTimeout(()=>{void (async()=>{
   const {error}=await supabase!.from("workspace_state").upsert({id:"main",data,updated_by:user.id,updated_by_client:clientId.current},{onConflict:"id"});
   if(error){setSyncStatus("error");setToast("Cloud sync failed. Check your database permissions.");return}
   const previous=savedData.current;
   savedData.current=data;
   savedSnapshot.current=snapshot;setSyncStatus("saved");
   if(previous){
    const changes=changesBetween(previous,data);
    void Promise.all(changes.map(async change=>{
     const {error:notifyError}=await supabase!.functions.invoke("discord-notify",{body:{...change,workspace:data.workspace}});
     const status=(notifyError as {context?:{status?:number}}|null)?.context?.status;
     if(notifyError&&status!==404&&!notificationWarningShown.current){notificationWarningShown.current=true;setToast("Saved, but Discord could not receive a change notice. Check the webhook setup.")}
    }));
   }
  })()},450);
  return()=>clearTimeout(timer);
 },[data,user.id]);
 useEffect(()=>{
  let alive=true;let refreshing=false;
  const applyRemoteRow=(row:WorkspaceRow)=>{
   if(row.updated_by_client===clientId.current)return;
   const incoming=normalizeStore(row.data,profile);incoming.members=membersRef.current;
   const remoteState=JSON.stringify(incoming);if(remoteState===savedSnapshot.current){setSyncStatus(current=>current==="error"?(JSON.stringify(currentData.current)===savedSnapshot.current?"saved":"saving"):current);return}
   const local=currentData.current;const localState=JSON.stringify(local);const hasLocalChanges=localState!==savedSnapshot.current;const baseline=savedData.current;
   const next=hasLocalChanges&&baseline?mergeLocalWorkspaceChanges(baseline,local,incoming):incoming;const nextState=JSON.stringify(next);
   remoteSnapshot.current=remoteState;savedSnapshot.current=remoteState;savedData.current=incoming;
   if(nextState===remoteState)remoteSnapshot.current=nextState;
   currentData.current=next;setData(previous=>JSON.stringify(previous)===nextState?previous:next);setSyncStatus(nextState===remoteState?"saved":"saving");
  };
  const refresh=async()=>{
   if(!alive||refreshing||document.visibilityState!=="visible")return;
   refreshing=true;
   try{
    const {data:row,error}=await supabase!.from("workspace_state").select("data,updated_by_client").eq("id","main").maybeSingle();
    if(!alive)return;
    if(error){setSyncStatus("error");return}
    if(row)applyRemoteRow(row as WorkspaceRow);else setSyncStatus(current=>current==="error"?"saved":current);
   }catch{
    if(alive)setSyncStatus("error");
   }finally{refreshing=false}
  };
  const onResume=()=>{if(document.visibilityState==="visible")void refresh()};
  const channel=supabase!.channel("workspace-state-main").on("postgres_changes",{event:"*",schema:"public",table:"workspace_state",filter:"id=eq.main"},payload=>{
   if(payload.eventType!=="DELETE")applyRemoteRow(payload.new as WorkspaceRow);
  }).subscribe(status=>{
   if(status==="SUBSCRIBED")void refresh();
   else if(status==="CHANNEL_ERROR"||status==="TIMED_OUT")setSyncStatus("error");
  });
  window.addEventListener("online",onResume);window.addEventListener("focus",onResume);document.addEventListener("visibilitychange",onResume);
  const timer=window.setInterval(onResume,20000);
  return()=>{alive=false;window.clearInterval(timer);window.removeEventListener("online",onResume);window.removeEventListener("focus",onResume);document.removeEventListener("visibilitychange",onResume);void supabase!.removeChannel(channel)};
 },[profile]);
 useEffect(()=>{
  const retention=data.completedTaskRetentionDays;if(!retention)return;
  const removeExpired=()=>setData(current=>{
   const completedIds=new Set(current.columns.filter(column=>/done|complete/i.test(column.title)).map(column=>column.id));const cutoff=Date.now()-retention*24*60*60*1000;
   const expired=current.tasks.filter(task=>completedIds.has(task.columnId)&&Date.parse(task.completedAt??task.updatedAt??task.createdAt)<=cutoff);
   if(!expired.length)return current;
   const now=new Date().toISOString();const events=expired.map(task=>({id:uid(),text:`automatically removed “${task.title}” after ${retention} days in Completed`,actor:"Workspace cleanup",date:now}));const expiredIds=new Set(expired.map(task=>task.id));
   return{...current,tasks:current.tasks.filter(task=>!expiredIds.has(task.id)),events:[...events,...current.events].slice(0,100)};
  });
  removeExpired();const timer=window.setInterval(removeExpired,60000);return()=>window.clearInterval(timer);
 },[data.completedTaskRetentionDays,data.columns]);
 useEffect(()=>{
  if(!supabase)return;
  const client=supabase;
  const channel=client.channel("workspace-presence-main",{config:{presence:{key:profile.id+":"+clientId.current}}});
  const sync=()=>{const state=channel.presenceState<{user_id?:string}>();const ids=Object.values(state).flatMap(entries=>entries.map(entry=>entry.user_id).filter((id):id is string=>!!id));setOnlineProfileIds([...new Set(ids)])};
  channel.on("presence",{event:"sync"},sync).subscribe(async status=>{if(status==="SUBSCRIBED"){await channel.track({user_id:profile.id});sync()}});
  return()=>{void channel.untrack();void client.removeChannel(channel)};
 },[profile.id]);
 useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(""),3500);return()=>clearTimeout(t)},[toast]);
 const displayMembers=data.members.map(member=>({...member,status:onlineProfileIds.includes(member.id)?"Online":"Offline"}));const viewData={...data,members:displayMembers};
 const self=displayMembers.find(member=>member.id===profile.id)??asMember(profile,0);
 const actor=self.name;
 const log=(text:string)=>setData(d=>({...d,events:[{id:uid(),text,actor,date:new Date().toISOString()},...d.events].slice(0,100)}));
 const addTaskComment=(id:string,text:string)=>{const now=new Date().toISOString();setData(current=>{const task=current.tasks.find(item=>item.id===id);if(!task)return current;const comment={id:uid(),text,author:actor,createdAt:now};return{...current,tasks:current.tasks.map(item=>item.id===id?{...item,comments:[...(item.comments??[]),comment]}:item),events:[{id:uid(),text:"commented on “"+task.title+"”",actor,date:now},...current.events].slice(0,100)}});setToast("Comment added")};
 const done=data.columns.filter(c=>/done|complete/i.test(c.title)).map(c=>c.id);const active=data.columns.filter(c=>/progress|review|testing/i.test(c.title)).map(c=>c.id);
 const stats={all:data.tasks.length,completed:data.tasks.filter(t=>done.includes(t.columnId)).length,active:data.tasks.filter(t=>active.includes(t.columnId)).length,late:data.tasks.filter(t=>late(t.dueDate)&&!done.includes(t.columnId)).length};
 const selected=data.tasks.find(t=>t.id===taskId)??null;
 const results=useMemo(()=>{const q=query.trim().toLowerCase();if(q.length<2)return[];return[
  ...data.tasks.filter(t=>(t.title+" "+t.description+" "+t.tags.join(" ")).toLowerCase().includes(q)).map(t=>({id:t.id,title:t.title,page:"Task board" as Page,task:true})),
  ...data.announcements.filter(a=>(a.title+" "+a.body).toLowerCase().includes(q)).map(a=>({id:a.id,title:a.title,page:"Announcements" as Page,task:false})),
  ...data.roadmaps.filter(r=>r.title.toLowerCase().includes(q)).map(r=>({id:r.id,title:r.title,page:"Roadmaps" as Page,task:false}))
 ].slice(0,7)},[data,query]);
 const saveTask=(draft:Omit<Task,"createdAt"|"updatedAt">)=>{const old=data.tasks.find(t=>t.id===draft.id);const now=new Date().toISOString();const completedIds=new Set(data.columns.filter(column=>/done|complete/i.test(column.title)).map(column=>column.id));const wasCompleted=!!old&&completedIds.has(old.columnId);const isCompleted=completedIds.has(draft.columnId);const saved:Task={...draft,comments:old?.comments??draft.comments??[],title:draft.title.trim(),createdAt:old?.createdAt??now,updatedAt:now,completedAt:isCompleted?(wasCompleted?old?.completedAt??old?.updatedAt:now):undefined};const eventText=old&&old.columnId!==saved.columnId?"moved “"+saved.title+"” from "+(data.columns.find(c=>c.id===old.columnId)?.title??"Unknown")+" to "+(data.columns.find(c=>c.id===saved.columnId)?.title??"Unknown"):(old?"updated ":"created ")+"“"+saved.title+"”";setData(d=>({...d,tasks:old?d.tasks.map(t=>t.id===saved.id?saved:t):[saved,...d.tasks],events:[{id:uid(),text:eventText,actor,date:now},...d.events]}));setTaskId(null);setCreating(false);setToast(old?"Task updated":"Task created")};
 const deleteTask=(id:string)=>{const old=data.tasks.find(t=>t.id===id);if(!old)return;setData(d=>({...d,tasks:d.tasks.filter(t=>t.id!==id),events:[{id:uid(),text:"deleted “"+old.title+"”",actor,date:new Date().toISOString()},...d.events]}));setTaskId(null);setToast("Task deleted")};
 const move=(id:string,col:string,before?:string)=>{const item=data.tasks.find(t=>t.id===id);if(!item)return;const from=data.columns.find(c=>c.id===item.columnId)?.title;const to=data.columns.find(c=>c.id===col)?.title;if(item.columnId===col&&(!before||before===id))return;setData(d=>{const tasks=d.tasks.filter(t=>t.id!==id);const at=before?tasks.findIndex(t=>t.id===before):-1;const now=new Date().toISOString();const wasCompleted=/done|complete/i.test(from??"");const isCompleted=/done|complete/i.test(to??"");const moved:Task={...item,columnId:col,updatedAt:now,completedAt:isCompleted?(wasCompleted?item.completedAt??item.updatedAt:now):undefined};tasks.splice(at<0?tasks.length:at,0,moved);const events=item.columnId===col?d.events:[{id:uid(),text:"moved “"+item.title+"” from "+from+" to "+to,actor,date:now},...d.events];return{...d,tasks,events}})};
 const addColumn=()=>{const title=prompt("New column name");if(title?.trim())setData(d=>({...d,columns:[...d.columns,{id:uid(),title:title.trim(),color:"#75a252"}]}))};
 const editColumn=(c:Column,remove=false)=>{if(remove){if(data.columns.length<2){setToast("Keep at least one column");return}if(!confirm("Delete "+c.title+"? Its cards move to the first column."))return;const fallback=data.columns.find(x=>x.id!==c.id)!;setData(d=>({...d,columns:d.columns.filter(x=>x.id!==c.id),tasks:d.tasks.map(t=>t.columnId===c.id?{...t,columnId:fallback.id}:t)}));log("deleted column “"+c.title+"”");return}const title=prompt("Rename column",c.title);if(title?.trim())setData(d=>({...d,columns:d.columns.map(x=>x.id===c.id?{...x,title:title.trim()}:x)}))};
 const addAnnouncement=()=>{const title=prompt("Announcement title");if(!title?.trim())return;const body=prompt("Announcement message");if(!body?.trim())return;const a:Announcement={id:uid(),title:title.trim(),body:body.trim(),pinned:false,category:"Team",date:new Date().toISOString(),author:actor};setData(d=>({...d,announcements:[a,...d.announcements]}));log("published announcement “"+a.title+"”")};
 const addRoadmap=()=>{const title=prompt("Initiative name");if(!title?.trim())return;const r:Roadmap={id:uid(),title:title.trim(),category:"General",progress:0,target:"",priority:"Medium"};setData(d=>({...d,roadmaps:[r,...d.roadmaps]}));log("created roadmap “"+r.title+"”")};
 const addResource=()=>{const title=prompt("Resource name");if(!title?.trim())return;const url=prompt("Website URL starting with https://");if(!url||!/^https?:\/\//i.test(url)){setToast("Enter a valid http or https link");return}const r:Resource={id:uid(),title:title.trim(),url,description:prompt("Short description")??"",category:"Operations"};setData(d=>({...d,resources:[...d.resources,r]}));log("added resource “"+r.title+"”")};
 const choose=(r:{id:string;page:Page;task:boolean})=>{setPage(r.page);if(r.task)setTaskId(r.id);setQuery("")};
 return <div className={"app "+data.theme} style={{"--accent":data.accent} as CSSProperties}>
  <aside className={"sidebar "+(collapsed?"collapsed ":"")+(mobile?"mobile-open":"")}><div className="brand"><BrandLogo src={data.logoUrl}/>{!collapsed&&<span className="brand-words"><b>ja-nee</b><small>MANAGEMENT</small></span>}<button className="icon-btn collapse" aria-label={collapsed?"Expand sidebar":"Collapse sidebar"} aria-expanded={!collapsed} title={collapsed?"Expand sidebar":"Collapse sidebar"} onClick={()=>setCollapsed(!collapsed)}>{collapsed?<ArrowRight size={15}/>:<ArrowLeft size={15}/>}</button><button className="icon-btn mobile-close" onClick={()=>setMobile(false)}><X size={16}/></button></div>
   {!collapsed&&<div className="workspace"><b className="workspace-mark">J</b><span><strong>{data.workspace}</strong><small>Management workspace</small></span><ChevronDown size={13}/></div>}<div className="nav-caption">{!collapsed&&"WORKSPACE"}</div>
   <nav>{nav.map(({name,icon:Icon})=><button key={name} title={collapsed?name:""} className={"nav-item "+(page===name?"active":"")} onClick={()=>{setPage(name);setMobile(false)}}><Icon size={16}/><span>{!collapsed&&name}</span>{name==="Task board"&&!collapsed&&<em>{stats.all-stats.completed}</em>}</button>)}</nav>
   <div className="side-bottom">{!collapsed&&<div className="online-caption">TEAM ONLINE <span>{displayMembers.filter(m=>m.status==="Online").length}</span></div>}<div className="online-avatars">{displayMembers.filter(m=>m.status==="Online").slice(0,4).map(m=><Avatar key={m.id} member={m} small/>)}</div>{!collapsed&&<div className="private-card"><ShieldCheck size={14}/><span><b>Shared workspace</b><small>{syncStatus==="saving"?"Syncing to Supabase…":syncStatus==="error"?"Sync needs attention":"Supabase synced"}</small></span></div>}<button className="profile" onClick={()=>setPage("Settings")}><Avatar member={self}/><span><b>{self.name}</b><small>{self.role}</small></span><MoreHorizontal size={15}/></button></div>
  </aside>{mobile&&<button className="scrim" onClick={()=>setMobile(false)}/>}
  <main className="main"><header className="topbar"><div className="top-title"><button className="icon-btn mobile-menu" onClick={()=>setMobile(true)}><Menu size={18}/></button><div><small>Workspace <span>/</span> {page}</small><h1>{page}</h1></div></div><div className="top-actions"><div className="searchbox"><Search size={14}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search anything..."/>{query.length<2&&<kbd>⌘ K</kbd>}{query.length>=2&&<div className="search-results">{results.length?results.map(r=><button key={r.id} onClick={()=>choose(r)}><Search size={13}/><span>{r.title}</span><small>{r.page}</small></button>):<p>No matches found</p>}</div>}</div><span className="online-count"><i/>{displayMembers.filter(m=>m.status==="Online").length} online</span><button className="icon-btn bell" onClick={()=>setPage("Calendar")} aria-label="Deadlines"><Bell size={16}/></button><button className="top-user" onClick={()=>setPage("Settings")}><Avatar member={self} small/><b>{self.name}</b><ChevronDown size={12}/></button></div></header>
   <section className="content"><div key={page} className="page-transition">
    {page==="Overview"&&<Overview data={viewData} userName={self.name} stats={stats} onPage={setPage} onNew={()=>{setCreating(true);setTaskId(null)}} onTask={setTaskId} menu={menu} onMenu={()=>setMenu(!menu)} onWidget={k=>setData(d=>({...d,widgets:{...d.widgets,[k]:!d.widgets[k]}}))}/>}
    {page==="Task board"&&<Board data={viewData} query={query.toLowerCase()} filter={filter} setFilter={setFilter} assigneeFilter={assigneeFilter} setAssigneeFilter={setAssigneeFilter} sort={sort} setSort={setSort} onNew={()=>{setCreating(true);setTaskId(null)}} onOpen={setTaskId} onDrag={setDrag} onDrop={(c,b)=>{if(drag)move(drag,c,b);setDrag(null)}} onColumn={editColumn} onAddColumn={addColumn}/>}
    {page==="Roadmaps"&&<Roadmaps data={data} onAdd={addRoadmap} onUpdate={r=>setData(d=>({...d,roadmaps:d.roadmaps.map(x=>x.id===r.id?r:x)}))}/>}
    {page==="Calendar"&&<CalendarPage data={data} onTask={setTaskId}/>}
    {page==="Announcements"&&<Announcements data={data} onAdd={addAnnouncement} onPin={a=>setData(d=>({...d,announcements:d.announcements.map(x=>x.id===a.id?{...x,pinned:!x.pinned}:x)}))}/>}
    {page==="Activity log"&&<ActivityPage data={data}/>}
    {page==="Members"&&<MembersPage data={viewData}/>}
    {page==="Resources"&&<ResourcesPage data={data} onAdd={addResource} onRemove={r=>{if(confirm("Remove "+r.title+"?"))setData(d=>({...d,resources:d.resources.filter(x=>x.id!==r.id)}))}}/>}
    {page==="Settings"&&<SettingsPage data={viewData} onChange={p=>setData(d=>({...d,...p}))} profile={profile} syncStatus={syncStatus} onSignOut={onSignOut}/>}
   </div></section>
  </main>
  {(selected||creating)&&<TaskDialog key={selected?.id??"new"} task={selected} data={viewData} syncStatus={syncStatus} onClose={()=>{setTaskId(null);setCreating(false)}} onSave={saveTask} onDelete={deleteTask} onComment={addTaskComment}/>}
  {toast&&<div className="toast"><Check size={14}/>{toast}</div>}
 </div>
}
function Avatar({member,small=false}:{member:Member;small?:boolean}){return <span className={"avatar "+(small?"small":"")} style={{background:member.color}} title={member.name}><span>{initials(member.name)}</span>{member.avatarUrl&&<img src={member.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event=>{event.currentTarget.style.display="none"}}/>}</span>}
function Heading({eyebrow,title,description,action}:{eyebrow:string;title:string;description:string;action?:React.ReactNode}){return <div className="heading"><div><small>{eyebrow}</small><h2>{title}</h2><p>{description}</p></div>{action}</div>}
function Badge({value}:{value:Priority}){return <span className={"priority "+value.toLowerCase()}>{value}</span>}
function Progress({value}:{value:number}){return <div className="progress"><i style={{width:Math.max(0,Math.min(100,value))+"%"}}/></div>}
function PanelTitle({title,sub,action}:{title:string;sub?:string;action?:React.ReactNode}){return <div className="panel-title"><div><b>{title}</b>{sub&&<small>{sub}</small>}</div>{action}</div>}
function Overview({data,userName,stats,onPage,onNew,onTask,menu,onMenu,onWidget}:{data:Store;userName:string;stats:{all:number;completed:number;active:number;late:number};onPage:(p:Page)=>void;onNew:()=>void;onTask:(id:string)=>void;menu:boolean;onMenu:()=>void;onWidget:(k:string)=>void}){
 const due=data.tasks.filter(t=>t.dueDate&&!/done|complete/i.test(data.columns.find(c=>c.id===t.columnId)?.title??"")).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)).slice(0,4);const h=TODAY.getHours();const greet=h<12?"Good morning":h<18?"Good afternoon":"Good evening";
 return <div><div className="welcome"><div className="orb"><span>JN</span></div><small>TEAM OVERVIEW</small><h2>{greet}, {userName} <em>✦</em></h2><p>Your team has <b>{stats.active} active tasks</b> and {stats.late?<b>{stats.late} overdue</b>:"no overdue tasks"}. Here's what's moving today.</p><div><button className="button outline" onClick={()=>onPage("Task board")}><ListTodo size={13}/>Open task board</button><button className="button light-button" onClick={onNew}><Plus size={13}/>New task</button></div></div>
 <div className="stat-grid"><Stat title="All tasks" value={stats.all} hint="Across all projects" icon={<ListTodo/>}/><Stat title="In progress" value={stats.active} hint="Moving forward" icon={<Zap/>}/><Stat title="Completed" value={stats.completed} hint="Well done, team" icon={<CheckCircle2/>}/><Stat title="Overdue" value={stats.late} hint={stats.late?"Needs attention":"On track"} icon={<CircleAlert/>}/></div>
 <div className="widget-tools"><button className="button outline small" onClick={onMenu}><SettingsIcon size={12}/>Customize overview</button>{menu&&<div className="widget-menu">{Object.entries({deadlines:"Upcoming deadlines",activity:"Recent activity",roadmap:"Roadmap progress",members:"Team presence"}).map(([k,v])=><label key={k}><input type="checkbox" checked={!!data.widgets[k]} onChange={()=>onWidget(k)}/>{v}</label>)}</div>}</div>
 <div className="overview-grid">{data.widgets.deadlines&&<section className="panel"><PanelTitle title="Upcoming deadlines" sub="What's coming up next" action={<button className="text-link" onClick={()=>onPage("Calendar")}>Calendar <ArrowRight size={12}/></button>}/>{due.length?due.map(t=><button className="deadline" key={t.id} onClick={()=>onTask(t.id)}><span className="date-block"><b>{new Date(t.dueDate+"T12:00:00").getDate()}</b><small>{new Date(t.dueDate+"T12:00:00").toLocaleDateString("en-ZA",{month:"short"})}</small></span><span className="deadline-text"><b>{t.title}</b><small>{data.columns.find(c=>c.id===t.columnId)?.title}</small></span><Badge value={t.priority}/></button>):<p className="empty-state">No upcoming deadlines yet. Add a task with a due date to see it here.</p>}</section>}
 {data.widgets.activity&&<section className="panel"><PanelTitle title="Recent activity" sub="Latest workspace changes" action={<button className="icon-btn" onClick={()=>onPage("Activity log")}><ArrowRight size={13}/></button>}/>{data.events.slice(0,4).map(e=><div className="event" key={e.id}><Avatar member={data.members.find(m=>m.name===e.actor)??data.members[0]} small/><span><b>{e.actor.split(" ")[0]}</b> {e.text}<small>{timeAgo(e.date)}</small></span></div>)}</section>}
 {data.widgets.roadmap&&<section className="panel"><PanelTitle title="Roadmap progress" sub="The bigger picture" action={<button className="text-link" onClick={()=>onPage("Roadmaps")}>View all <ArrowRight size={12}/></button>}/>{data.roadmaps.slice(0,3).map(r=><div className="roadmap-mini" key={r.id}><div><b>{r.title}</b><small>{r.progress}%</small></div><Progress value={r.progress}/><small>{r.category} · Target {fmt(r.target)}</small></div>)}</section>}
 {data.widgets.members&&<section className="panel"><PanelTitle title="Team presence" sub="Who's around today" action={<button className="text-link" onClick={()=>onPage("Members")}>Team <ArrowRight size={12}/></button>}/>{data.members.slice(0,4).map(m=><div className="member-line" key={m.id}><span className="presence"><Avatar member={m} small/><i className={m.status.toLowerCase()}/></span><span><b>{m.name}</b><small>{m.role}</small></span><small className={"presence-text "+m.status.toLowerCase()}>{m.status}</small></div>)}</section>}</div>
 <div className="quick"><div><small>KEEP THINGS MOVING</small><b>Quick actions</b></div><button onClick={onNew}><Plus/>Create a task</button><button onClick={()=>onPage("Announcements")}><MessageCircle/>Announcements</button><button onClick={()=>onPage("Roadmaps")}><Milestone/>Roadmap item</button><button onClick={()=>onPage("Resources")}><Link2/>Resources</button></div></div>
}
function Stat({title,value,hint,icon}:{title:string;value:number;hint:string;icon:React.ReactNode}){return <div className="stat"><span>{icon}</span><small>{title}</small><b>{value}</b><em>{hint}</em></div>}
function Board({data,query,filter,setFilter,assigneeFilter,setAssigneeFilter,sort,setSort,onNew,onOpen,onDrag,onDrop,onColumn,onAddColumn}:{data:Store;query:string;filter:string;setFilter:(s:string)=>void;assigneeFilter:string;setAssigneeFilter:(s:string)=>void;sort:string;setSort:(s:string)=>void;onNew:()=>void;onOpen:(id:string)=>void;onDrag:(id:string)=>void;onDrop:(c:string,b?:string)=>void;onColumn:(c:Column,r?:boolean)=>void;onAddColumn:()=>void}){
 return <div className="section"><Heading eyebrow="TEAM WORKSPACE" title="Task board" description="Plan, assign, and move work forward together." action={<button className="button primary" onClick={onNew}><Plus size={13}/>Create task</button>}/><div className="board-tools"><span className="board-name"><LayoutDashboard size={12}/>Main board</span><span>{data.tasks.length} cards</span><span className="tool-spacer"/><Filter size={12}/><select value={filter} onChange={e=>setFilter(e.target.value)}><option>All priorities</option><option>Urgent</option><option>High</option><option>Medium</option><option>Low</option></select><select value={assigneeFilter} onChange={e=>setAssigneeFilter(e.target.value)}><option>Everyone</option>{data.members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select><select value={sort} onChange={e=>setSort(e.target.value)}><option>Manual</option><option>Priority</option><option>Due date</option><option>Recently updated</option></select></div>
 <div className="board">{data.columns.map(c=>{let list=data.tasks.filter(t=>t.columnId===c.id&&(filter==="All priorities"||filter===t.priority)&&(assigneeFilter==="Everyone"||t.assignees.includes(assigneeFilter))&&(!query||(t.title+" "+t.description+" "+t.tags.join(" ")).toLowerCase().includes(query)));if(sort==="Priority")list.sort((a,b)=>prio[a.priority]-prio[b.priority]);if(sort==="Due date")list.sort((a,b)=>(a.dueDate||"9999").localeCompare(b.dueDate||"9999"));if(sort==="Recently updated")list.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));return <div className="column" key={c.id} onDragOver={e=>e.preventDefault()} onDrop={()=>onDrop(c.id)}><div className="column-title"><i style={{background:c.color}}/><b>{c.title}</b><small>{data.tasks.filter(t=>t.columnId===c.id).length}</small><button className="icon-btn tiny" onClick={()=>{const a=prompt("Type rename or delete","rename");if(a?.toLowerCase()==="rename")onColumn(c);if(a?.toLowerCase()==="delete")onColumn(c,true)}}><MoreHorizontal size={14}/></button></div>{list.map(t=><TaskCard key={t.id} task={t} members={data.members} tags={data.tags} onOpen={()=>onOpen(t.id)} onDrag={()=>onDrag(t.id)} onDrop={()=>onDrop(c.id,t.id)}/>)}<button className="add-inline" onClick={onNew}><Plus size={12}/>Add a task</button></div>})}<button className="add-column" onClick={onAddColumn}><Plus size={13}/>Add column</button></div></div>
}
function TaskCard({task,members,tags,onOpen,onDrag,onDrop}:{task:Task;members:Member[];tags:WorkspaceTag[];onOpen:()=>void;onDrag:()=>void;onDrop:()=>void}){return <article className="task-card" draggable onDragStart={onDrag} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.stopPropagation();onDrop()}} onClick={onOpen}><div className="task-top"><Badge value={task.priority}/><MoreHorizontal size={13}/></div><b>{task.title}</b>{task.description&&<div className="task-card-description"><MarkdownContent text={task.description}/></div>}{task.tags.length>0&&<div className="tags">{task.tags.map(x=>{const tag=tags.find(item=>item.name===x);return <span key={x} style={tag?{color:tag.color,background:`color-mix(in srgb, ${tag.color} 18%, transparent)`,borderColor:`color-mix(in srgb, ${tag.color} 40%, transparent)`}:{}}>{x}</span>})}</div>}<div className="task-foot">{task.dueDate&&<span className={late(task.dueDate)?"late":""}><CalendarDays size={10}/>{fmt(task.dueDate)}</span>}{task.checklist.length>0&&<span><Check size={10}/>{task.checklist.filter(x=>x.done).length}/{task.checklist.length}</span>}<div>{task.assignees.slice(0,3).map(id=>{const m=members.find(x=>x.id===id);return m&&<Avatar key={id} member={m} small/>})}</div></div></article>}
function inlineMarkdown(source:string):React.ReactNode[]{
 const expression=/\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|`([^`]+)`|\*([^*\n]+)\*|_([^_\n]+)_|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;const nodes:React.ReactNode[]=[];let cursor=0;let index=0;
 for(const match of source.matchAll(expression)){const start=match.index??0;if(start>cursor)nodes.push(source.slice(cursor,start));const key=`inline-${index++}`;if(match[1]||match[2])nodes.push(<strong key={key}>{match[1]??match[2]}</strong>);else if(match[3])nodes.push(<del key={key}>{match[3]}</del>);else if(match[4])nodes.push(<code key={key}>{match[4]}</code>);else if(match[5]||match[6])nodes.push(<em key={key}>{match[5]??match[6]}</em>);else if(match[7]&&match[8])nodes.push(<a key={key} href={match[8]} target="_blank" rel="noopener noreferrer" onClick={event=>event.stopPropagation()}>{match[7]}</a>);cursor=start+match[0].length}
 if(cursor<source.length)nodes.push(source.slice(cursor));return nodes;
}
function MarkdownContent({text,className=""}:{text:string;className?:string}){
 const lines=text.replace(/\r\n?/g,"\n").split("\n");const blocks:React.ReactNode[]=[];let index=0;
 const listMatch=(line:string)=>/^\s*(?:[-*+]\s+|\d+[.)]\s+)/.exec(line);
 while(index<lines.length){const line=lines[index].trim();if(!line){index++;continue}
  if(line.startsWith("```")){const language=line.slice(3).trim();const code:string[]=[];index++;while(index<lines.length&&!lines[index].trim().startsWith("```"))code.push(lines[index++]);if(index<lines.length)index++;blocks.push(<pre key={`block-${blocks.length}`} data-language={language||undefined}><code>{code.join("\n")}</code></pre>);continue}
  const heading=/^(#{1,6})\s+(.+)$/.exec(line);if(heading){const level=heading[1].length;const content=inlineMarkdown(heading[2]);const key=`block-${blocks.length}`;if(level===1)blocks.push(<h1 key={key}>{content}</h1>);else if(level===2)blocks.push(<h2 key={key}>{content}</h2>);else if(level===3)blocks.push(<h3 key={key}>{content}</h3>);else if(level===4)blocks.push(<h4 key={key}>{content}</h4>);else if(level===5)blocks.push(<h5 key={key}>{content}</h5>);else blocks.push(<h6 key={key}>{content}</h6>);index++;continue}
  if(/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)){blocks.push(<hr key={`block-${blocks.length}`}/>);index++;continue}
  if(line.startsWith(">")){const quote:string[]=[];while(index<lines.length&&lines[index].trim().startsWith(">"))quote.push(lines[index++].trim().replace(/^>\s?/,""));blocks.push(<blockquote key={`block-${blocks.length}`}>{inlineMarkdown(quote.join(" "))}</blockquote>);continue}
  const firstList=listMatch(lines[index]);if(firstList){const ordered=/^\s*\d/.test(lines[index]);const items:React.ReactNode[]=[];while(index<lines.length){const match=listMatch(lines[index]);if(!match||/^\s*\d/.test(lines[index])!==ordered)break;items.push(<li key={`item-${items.length}`}>{inlineMarkdown(lines[index].replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/,""))}</li>);index++}blocks.push(ordered?<ol key={`block-${blocks.length}`}>{items}</ol>:<ul key={`block-${blocks.length}`}>{items}</ul>);continue}
  const paragraph=[line];index++;while(index<lines.length&&lines[index].trim()&&!/^(?:#{1,6}\s|```|>|(?:-{3,}|\*{3,}|_{3,})$)/.test(lines[index].trim())&&!listMatch(lines[index]))paragraph.push(lines[index++].trim());blocks.push(<p key={`block-${blocks.length}`}>{inlineMarkdown(paragraph.join(" "))}</p>);
 }
 return <div className={`markdown-content ${className}`.trim()}>{blocks}</div>;
}
function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}){
 const modalRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{const root=document.documentElement;const body=document.body;const oldRootOverflow=root.style.overflow;const oldBodyOverflow=body.style.overflow;const previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;root.style.overflow="hidden";body.style.overflow="hidden";const initialFocus=modalRef.current?.querySelector<HTMLElement>("[data-dialog-autofocus]");initialFocus?.focus();return()=>{root.style.overflow=oldRootOverflow;body.style.overflow=oldBodyOverflow;previousFocus?.focus()}},[]);
 const trapFocus=(event:React.KeyboardEvent<HTMLDivElement>)=>{if(event.key==="Escape"){event.preventDefault();onClose();return}if(event.key!=="Tab")return;const elements=[...event.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter(element=>element.offsetWidth||element.offsetHeight||element===document.activeElement);const first=elements[0];const last=elements[elements.length-1];if(!first||!last){event.preventDefault();event.currentTarget.focus();return}if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}else if(!event.currentTarget.contains(document.activeElement)){event.preventDefault();first.focus()}};
 return <div className="backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}><div ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabIndex={-1} onKeyDown={trapFocus}><header><div><small>JA-NEE MANAGEMENT</small><h2 id="dialog-title">{title}</h2></div><button className="icon-btn" aria-label="Close dialog" onClick={onClose}><X size={15}/></button></header>{children}</div></div>
}
function TaskDialog({task,data,syncStatus,onClose,onSave,onDelete,onComment}:{task:Task|null;data:Store;syncStatus:"saved"|"saving"|"error";onClose:()=>void;onSave:(t:Omit<Task,"createdAt"|"updatedAt">)=>void;onDelete:(id:string)=>void;onComment:(id:string,text:string)=>void}){
 const [title,setTitle]=useState(task?.title??"");const [description,setDescription]=useState(task?.description??"");const [columnId,setColumn]=useState(task?.columnId??data.columns[0]?.id??"");const [priority,setPriority]=useState<Priority>(task?.priority??"Medium");const [dueDate,setDue]=useState(task?.dueDate??"");const [tags,setTags]=useState(task?.tags??[]);const [assignees,setAssignees]=useState(task?.assignees??[]);const [checks,setChecks]=useState(task?.checklist??[]);const [newCheck,setNewCheck]=useState("");const [comment,setComment]=useState("");
 const usage=(tag:WorkspaceTag)=>data.tasks.reduce((count,item)=>count+(item.tags.includes(tag.name)?1:0),0);const rankedTags=[...data.tags].sort((a,b)=>usage(b)-usage(a)||a.name.localeCompare(b.name));const suggestedTags=rankedTags.filter(tag=>usage(tag)>0).slice(0,3);const suggestedIds=new Set(suggestedTags.map(tag=>tag.id));
 const addCheck=()=>{if(newCheck.trim())setChecks([...checks,{id:uid(),text:newCheck.trim(),done:false}]);setNewCheck("")};
 const sendComment=()=>{const text=comment.trim();if(!task||!text)return;onComment(task.id,text);setComment("")};
 const toggleTag=(name:string)=>setTags(current=>current.includes(name)?current.filter(x=>x!==name):[...current,name]);
 const tagOption=(tag:WorkspaceTag,showUsage=false)=><label className="tag-option" key={tag.id}><input type="checkbox" checked={tags.includes(tag.name)} onChange={()=>toggleTag(tag.name)}/><span style={{color:tag.color,"--tag-color":tag.color} as CSSProperties}>{tag.name}{showUsage&&<small className="tag-use-count">{usage(tag)} uses</small>}</span></label>;
 const submit=(event:FormEvent)=>{event.preventDefault();if(!title.trim())return;onSave({id:task?.id??uid(),title,description,columnId,priority,dueDate,tags,assignees,checklist:checks,comments:task?.comments??[]})};
 return <Modal title={task?"Task details":"Create a task"} onClose={onClose}>
  <form className="task-form" onSubmit={submit}>
   <div>
    <label>Task title<input data-dialog-autofocus value={title} onChange={event=>setTitle(event.target.value)} placeholder="What needs to get done?" required/></label>
    <label>Description<textarea rows={5} value={description} onChange={event=>setDescription(event.target.value)} placeholder="Add context for your team..."/><small className="markdown-hint">Markdown supported: # headings, - bullet lists, **bold**, and `code`.</small></label>
    {description.trim()&&<section className="description-preview"><div className="preview-heading">Live preview</div><MarkdownContent text={description}/></section>}
    <div className="checklist"><b>Checklist</b>{checks.map(item=><label className="check-row" key={item.id}><input type="checkbox" checked={item.done} onChange={()=>setChecks(checks.map(entry=>entry.id===item.id?{...entry,done:!entry.done}:entry))}/><span>{item.text}</span><button type="button" onClick={()=>setChecks(checks.filter(entry=>entry.id!==item.id))}><X size={11}/></button></label>)}<div className="add-check"><input value={newCheck} onChange={event=>setNewCheck(event.target.value)} placeholder="Add checklist item" onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();addCheck()}}}/><button type="button" onClick={addCheck}><Plus size={12}/></button></div></div>
    {task&&<div className="checklist discussion-list"><div className="discussion-heading"><b>Discussion</b><small className={`comment-sync ${syncStatus}`}>{syncStatus==="saving"?"Saving…":syncStatus==="error"?"Sync error":"Saved"}</small></div>{task.comments.map(item=><p className="comment" key={item.id}><strong>{item.author}</strong><span>{item.text}</span>{item.createdAt&&<small>{timeAgo(item.createdAt)}</small>}</p>)}<div className="add-check"><input value={comment} onChange={event=>setComment(event.target.value)} placeholder="Write a comment..." onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();sendComment()}}}/><button type="button" onClick={sendComment} disabled={!comment.trim()} aria-label="Add comment"><MessageCircle size={12}/></button></div></div>}
   </div>
   <aside>
    <label>Status<select value={columnId} onChange={event=>setColumn(event.target.value)}>{data.columns.map(column=><option key={column.id} value={column.id}>{column.title}</option>)}</select></label>
    <label>Priority<select value={priority} onChange={event=>setPriority(event.target.value as Priority)}><option>Low</option><option>Medium</option><option>High</option><option>Urgent</option></select></label>
    <label>Due date<input type="date" value={dueDate} onChange={event=>setDue(event.target.value)}/></label>
    <fieldset><legend>Assignees</legend>{data.members.map(member=><label className="assignee" key={member.id}><input type="checkbox" checked={assignees.includes(member.id)} onChange={()=>setAssignees(assignees.includes(member.id)?assignees.filter(id=>id!==member.id):[...assignees,member.id])}/><Avatar member={member} small/>{member.name}</label>)}</fieldset>
    <fieldset className="tag-picker"><legend>Tags</legend>{data.tags.length?<><div className="tag-group">{suggestedTags.length>0&&<small className="tag-group-heading">Suggested · used most</small>}{suggestedTags.map(tag=>tagOption(tag,true))}</div>{rankedTags.some(tag=>!suggestedIds.has(tag.id))&&<div className="tag-group"><small className="tag-group-heading">All tags</small>{rankedTags.filter(tag=>!suggestedIds.has(tag.id)).map(tag=>tagOption(tag))}</div>}</>:<small>Create reusable tags in Settings first.</small>}</fieldset>
   </aside>
   <footer>{task&&<button type="button" className="button danger" onClick={()=>onDelete(task.id)}><Trash2 size={12}/>Delete</button>}<span/><button type="button" className="button outline" onClick={onClose}>Cancel</button><button className="button primary"><Check size={12}/>{task?"Save changes":"Create task"}</button></footer>
  </form>
 </Modal>
}
function Roadmaps({data,onAdd,onUpdate}:{data:Store;onAdd:()=>void;onUpdate:(r:Roadmap)=>void}){return <div className="section"><Heading eyebrow="PLAN AHEAD" title="Roadmaps" description="Track the bigger initiatives behind the next milestones." action={<button className="button primary" onClick={onAdd}><Plus size={13}/>New roadmap item</button>}/><div className="roadmap-grid">{!data.roadmaps.length&&<p className="empty-state">No roadmap items yet. Create one to track a bigger goal.</p>}{data.roadmaps.map(r=><article className="roadmap-card" key={r.id}><header><span>{r.category}</span><Badge value={r.priority}/></header><h3>{r.title}</h3><p>{r.progress===100?"Completed":r.progress?"In progress":"Planned"}</p><Progress value={r.progress}/><input type="range" min="0" max="100" value={r.progress} onChange={e=>onUpdate({...r,progress:Number(e.target.value)})}/><footer><span>{r.progress}%</span><span>Target {fmt(r.target)}</span></footer></article>)}</div></div>}
function CalendarPage({data,onTask}:{data:Store;onTask:(id:string)=>void}){const [offset,setOffset]=useState(0);const month=new Date(TODAY.getFullYear(),TODAY.getMonth()+offset,1);const count=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();const first=new Date(month.getFullYear(),month.getMonth(),1).getDay();const key=month.getFullYear()+"-"+String(month.getMonth()+1).padStart(2,"0");const tasks=data.tasks.filter(t=>t.dueDate.startsWith(key));return <div className="section"><Heading eyebrow="DATES THAT MATTER" title="Calendar" description="Shared view of task deadlines." action={<div className="month-tools"><button className="button outline" onClick={()=>setOffset(offset-1)}>‹</button><b>{month.toLocaleDateString("en-ZA",{month:"long",year:"numeric"})}</b><button className="button outline" onClick={()=>setOffset(offset+1)}>›</button><button className="button outline" onClick={()=>setOffset(0)}>Today</button></div>}/><div className="calendar-grid">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=><b className="weekday" key={d}>{d}</b>)}{Array.from({length:first},(_,i)=><div className="calendar-day empty" key={"e"+i}/>)}{Array.from({length:count},(_,i)=>{const n=i+1;const date=month.getFullYear()+"-"+String(month.getMonth()+1).padStart(2,"0")+"-"+String(n).padStart(2,"0");return <div className="calendar-day" key={date}><span>{n}</span>{data.tasks.filter(t=>t.dueDate===date).slice(0,2).map(t=><button key={t.id} onClick={()=>onTask(t.id)}>{t.title}</button>)}</div>})}</div><div className="month-deadlines"><h3>Deadlines this month · {tasks.length}</h3>{tasks.sort((a,b)=>a.dueDate.localeCompare(b.dueDate)).map(t=><button key={t.id} onClick={()=>onTask(t.id)}><b>{fmt(t.dueDate)}</b><span>{t.title}</span><Badge value={t.priority}/></button>)}</div></div>}
function Announcements({data,onAdd,onPin}:{data:Store;onAdd:()=>void;onPin:(a:Announcement)=>void}){return <div className="section"><Heading eyebrow="IMPORTANT UPDATES" title="Announcements" description="Decisions, releases, and important team notes." action={<button className="button primary" onClick={onAdd}><Plus size={13}/>New announcement</button>}/><div className="announcement-list">{!data.announcements.length&&<p className="empty-state">No announcements yet. Create the first update when you are ready.</p>}{data.announcements.map(a=><article className={"announcement "+(a.pinned?"pinned":"")} key={a.id}><i/><div><small>{a.category}{a.pinned?" · PINNED":""}</small><h3>{a.title}</h3><p>{a.body}</p><footer><span>{a.author??"Management"} · {timeAgo(a.date)}</span><button className="text-link" onClick={()=>onPin(a)}>{a.pinned?"Unpin":"Pin"}</button></footer></div></article>)}</div></div>}
function ActivityPage({data}:{data:Store}){return <div className="section"><Heading eyebrow="WORKSPACE HISTORY" title="Activity log" description="A running record of changes in this workspace."/><div className="panel activity-list">{!data.events.length&&<p className="empty-state">Workspace activity will appear here as your team makes changes.</p>}{data.events.map(e=><div className="activity-row" key={e.id}><Activity size={14}/><span><b>{e.actor}</b> {e.text}</span><small>{timeAgo(e.date)}</small></div>)}</div></div>}
function MembersPage({data}:{data:Store}){const [q,setQ]=useState("");const people=data.members.filter(m=>(m.name+m.handle+m.role).toLowerCase().includes(q.toLowerCase()));return <div className="section"><Heading eyebrow="YOUR PEOPLE" title="Members" description="The people keeping Ja-Nee moving."/><input className="member-search" value={q} onChange={e=>setQ(e.target.value)} placeholder="Find a teammate..."/><div className="member-grid">{people.map(m=><article className="member-card" key={m.id}><Avatar member={m}/><h3>{m.name}</h3><p>{m.handle}</p><footer><ShieldCheck size={12}/>{m.role}<span>· {m.status}</span></footer></article>)}</div></div>}
function ResourcesPage({data,onAdd,onRemove}:{data:Store;onAdd:()=>void;onRemove:(r:Resource)=>void}){return <div className="section"><Heading eyebrow="TEAM SHORTCUTS" title="Resources" description="Frequently used links gathered in one place." action={<button className="button primary" onClick={onAdd}><Plus size={13}/>Add resource</button>}/><div className="resource-grid">{!data.resources.length&&<p className="empty-state">No saved links yet. Add the resources your team uses.</p>}{data.resources.map(r=><article className="resource-card" key={r.id}><span><ExternalLink size={15}/></span><div><b>{r.title}</b><p>{r.description}</p><small>{r.category}</small></div><button className="icon-btn" onClick={()=>onRemove(r)} aria-label="Remove resource"><Trash2 size={13}/></button><a href={r.url} target="_blank" rel="noreferrer" aria-label={"Open "+r.title}><ArrowRight size={14}/></a></article>)}</div></div>}
function SettingsPage({data,onChange,profile,syncStatus,onSignOut}:{data:Store;onChange:(p:Partial<Store>)=>void;profile:WorkspaceProfile;syncStatus:"saved"|"saving"|"error";onSignOut:()=>Promise<void>}){
 const [tagName,setTagName]=useState("");const [tagColor,setTagColor]=useState("#75a252");const [tagError,setTagError]=useState("");const [logoError,setLogoError]=useState("");const logoInput=useRef<HTMLInputElement>(null);
 const syncLabel=syncStatus==="saving"?"Saving changes to the shared database…":syncStatus==="error"?"A change could not sync. Check your connection and database access.":"Connected · changes are saved to the shared database";
 const addTag=()=>{const name=tagName.trim();if(!name)return;if(data.tags.some(tag=>tag.name.toLowerCase()===name.toLowerCase())){setTagError("That tag already exists.");return}onChange({tags:[...data.tags,{id:uid(),name,color:tagColor}]});setTagName("");setTagError("")};
 const updateTag=(tag:WorkspaceTag,patch:Partial<WorkspaceTag>)=>{const next={...tag,...patch};const tags=data.tags.map(item=>item.id===tag.id?next:item);const tasks=patch.name!==undefined?data.tasks.map(task=>({...task,tags:task.tags.map(name=>name===tag.name?next.name:name)})):data.tasks;onChange({tags,tasks})};
 const removeTag=(tag:WorkspaceTag)=>{if(!confirm(`Delete “${tag.name}” from the workspace and its tasks?`))return;onChange({tags:data.tags.filter(item=>item.id!==tag.id),tasks:data.tasks.map(task=>({...task,tags:task.tags.filter(name=>name!==tag.name)}))})};
 const uploadLogo=async(event:ChangeEvent<HTMLInputElement>)=>{
  const input=event.currentTarget;const file=input.files?.[0];if(!file)return;
  if(!["image/png","image/jpeg","image/webp"].includes(file.type)){setLogoError("Choose a PNG, JPG, or WebP image.");input.value="";return}
  if(file.size>5*1024*1024){setLogoError("Choose an image smaller than 5 MB.");input.value="";return}
  try{
   const bitmap=await createImageBitmap(file);const scale=Math.min(1,384/bitmap.width,384/bitmap.height);const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   const context=canvas.getContext("2d");if(!context){bitmap.close();setLogoError("This image could not be processed.");return}context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
   const logoUrl=canvas.toDataURL("image/webp",0.84);if(logoUrl.length>450_000){setLogoError("This image is still too large after resizing. Try a simpler logo.");return}onChange({logoUrl});setLogoError("");
  }catch{setLogoError("This image could not be opened. Try another file.")}
  finally{input.value=""}
 };
 return <div className="section"><Heading eyebrow="MAKE IT YOURS" title="Settings" description="Configure your shared workspace."/><div className="settings-grid"><div><section className="settings-card"><h3>Workspace appearance</h3><p>These preferences are shared with approved members.</p><label>Workspace name<input value={data.workspace} onChange={e=>onChange({workspace:e.target.value})}/></label><label>Accent colour<input type="color" value={data.accent} onChange={e=>onChange({accent:e.target.value})}/></label><div className="theme-tools"><button className="button outline" onClick={()=>onChange({theme:"dark"})}>Dark mode</button><button className="button outline" onClick={()=>onChange({theme:"light"})}>Light mode</button></div></section>
 <section className="settings-card"><h3>Workspace logo</h3><p>Choose a small image for the top left of the dashboard. It will be shared with your team.</p><div className="logo-setting"><BrandLogo src={data.logoUrl}/><div className="logo-setting-copy"><b>{data.logoUrl?"Custom logo":"Default Ja-Nee logo"}</b><small>PNG, JPG, or WebP · resized for the workspace</small></div><input ref={logoInput} className="logo-file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={event=>void uploadLogo(event)}/><button className="button outline" onClick={()=>logoInput.current?.click()}>Upload image</button>{data.logoUrl&&<button className="button outline" onClick={()=>{onChange({logoUrl:""});setLogoError("")}}>Use default</button>}</div>{logoError&&<small className="tag-error">{logoError}</small>}</section>
 <section className="settings-card tag-settings"><h3>Task tags</h3><p>Create shared tags with colors. Teammates can assign these tags when creating or editing tasks.</p><div className="tag-create"><input value={tagName} onChange={e=>{setTagName(e.target.value);setTagError("")}} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addTag()}}} placeholder="Tag name" aria-label="New tag name"/><input type="color" value={tagColor} onChange={e=>setTagColor(e.target.value)} aria-label="New tag color"/><button className="button primary" onClick={addTag} disabled={!tagName.trim()}><Plus size={14}/>Add tag</button></div>{tagError&&<small className="tag-error">{tagError}</small>}<div className="tag-list">{data.tags.map(tag=><div className="tag-setting-row" key={tag.id}><span className="tag-swatch" style={{background:tag.color}}/><input className="tag-name-input" value={tag.name} onChange={e=>updateTag(tag,{name:e.target.value})} aria-label={`Rename ${tag.name}`}/><input type="color" value={tag.color} onChange={e=>updateTag(tag,{color:e.target.value})} aria-label={`Change ${tag.name} color`}/><button className="icon-btn" type="button" onClick={()=>removeTag(tag)} aria-label={`Delete ${tag.name}`}><Trash2 size={15}/></button></div>)}{!data.tags.length&&<p className="tag-empty">Your saved tags will appear here.</p>}</div></section>
 <section className="settings-card"><h3>Completed task cleanup</h3><p>Automatically remove cards after they have stayed in a completed column for the selected time.</p><label className="retention-setting">Delete completed cards after<select value={data.completedTaskRetentionDays} onChange={event=>onChange({completedTaskRetentionDays:Number(event.target.value)})}><option value={0}>Never</option><option value={1}>1 day</option><option value={3}>3 days</option><option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option><option value={60}>60 days</option><option value={90}>90 days</option></select></label><small className="retention-note">The timer starts when a card is moved to a Completed or Done column. Cleanup runs while a teammate has the dashboard open; expired cards are removed the next time it is opened.</small></section>
 <section className="settings-card"><h3>Overview widgets</h3>{Object.entries({deadlines:"Upcoming deadlines",activity:"Recent activity",roadmap:"Roadmap progress",members:"Team presence"}).map(([k,v])=><label className="toggle-line" key={k}>{v}<input type="checkbox" checked={!!data.widgets[k]} onChange={()=>onChange({widgets:{...data.widgets,[k]:!data.widgets[k]}})}/></label>)}</section></div><aside><section className="settings-card"><h3>Account</h3><p>Signed in with a connected OAuth provider.</p><div className="integration"><b>{profile.display_name||profile.username||"Team member"}</b><small>{profile.username?"@"+profile.username:profile.id}</small></div><div className="integration">Workspace access<small>{roleName(profile.role)} · approved</small></div><button className="button outline signout-button" onClick={()=>void onSignOut()}><LogOut size={13}/>Sign out</button></section><section className="settings-card"><h3>Connected services</h3><p>Sign-in uses GitHub. Discord receives workspace change notices through a secure webhook.</p><div className="integration">Supabase database<small>{syncLabel}</small></div><div className="integration">GitHub sign-in<small>Connected through Supabase Authentication</small></div><div className="integration">Discord change log<small>Webhook notifications are sent securely by Supabase</small></div></section></aside></div></div>
}
