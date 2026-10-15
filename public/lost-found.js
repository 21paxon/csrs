(() => {
  const token = sessionStorage.getItem("csrs_token");
  let user = {};
  try { user = JSON.parse(sessionStorage.getItem("csrs_user") || "{}"); } catch {}
  const $ = id => document.getElementById(id);
  const officerRoles = ["admin","head_security","security_officer"];
  const isOfficer = officerRoles.includes(user.role);
  function logout(){sessionStorage.removeItem("csrs_token");sessionStorage.removeItem("csrs_user");window.top.location.replace("/index.html");}
  async function api(url, options={}) {
    const response = await fetch(url,{...options,headers:{Authorization:"Bearer "+token,Accept:"application/json",...(options.body instanceof FormData?{}:options.body?{"Content-Type":"application/json"}:{}),...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(response.status===401){logout();throw new Error("Your session expired. Sign in again.");}
    if(!response.ok)throw new Error(data.error||data.message||"Request failed (HTTP "+response.status+").");
    return data;
  }
  function msg(el,text,error=false){el.textContent=text;el.className="message "+(error?"error":"ok");}
  function date(v){if(!v)return "—";const d=new Date(v);return Number.isNaN(d.getTime())?"—":d.toLocaleDateString();}
  function addCell(tr,value){const td=document.createElement("td");td.textContent=value==null||value===""?"—":String(value);tr.appendChild(td);}
  function renderRows(id,items,fields,emptyText){const body=$(id);body.replaceChildren();if(!items.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=fields.length;td.textContent=emptyText;tr.appendChild(td);body.appendChild(tr);return;}items.forEach(item=>{const tr=document.createElement("tr");fields.forEach(key=>addCell(tr,key==="date_lost"||key==="date_found"?date(item[key]):item[key]));body.appendChild(tr);});}
  async function loadLost(){try{const items=await api("/api/lost-found/lost");renderRows("lostRows",items,[ "item_name","category","location_lost","date_lost","status"],"No lost-item reports found.");}catch(e){msg($("lostMessage"),e.message,true);}}
  async function loadFound(){try{const items=await api("/api/lost-found/found");renderRows("foundRows",items,["item_name","category","location_found","date_found","description"],"No open found items are listed.");}catch(e){msg($("pageMessage"),e.message,true);}}
  async function submitMultipart(url,form,buttonId,messageId,success){const button=$(buttonId);button.disabled=true;msg($(messageId),"Submitting…");try{await api(url,{method:"POST",body:new FormData(form)});form.reset();msg($(messageId),success);await loadLost();await loadFound();}catch(e){msg($(messageId),e.message,true);}finally{button.disabled=false;}}
  $("lostForm").addEventListener("submit",e=>{e.preventDefault();submitMultipart("/api/lost-found/lost",e.currentTarget,"lostSubmit","lostMessage","Lost-item report submitted.");});
  $("foundForm").addEventListener("submit",e=>{e.preventDefault();submitMultipart("/api/lost-found/found",e.currentTarget,"foundSubmit","foundMessage","Found item registered.");});
  $("matchForm").addEventListener("submit",async e=>{e.preventDefault();const form=e.currentTarget;const lost_id=Number(form.elements.lost_id.value),found_id=Number(form.elements.found_id.value);try{await api("/api/lost-found/match",{method:"POST",body:JSON.stringify({lost_id,found_id})});form.reset();msg($("matchMessage"),"Items matched successfully.");await loadLost();await loadFound();}catch(err){msg($("matchMessage"),err.message,true);}});
  document.querySelectorAll("[data-tab]").forEach(button=>button.addEventListener("click",()=>{const tab=button.dataset.tab;document.querySelectorAll("[data-tab]").forEach(b=>b.classList.toggle("active",b===button));$("lostPanel").classList.toggle("hidden",tab!=="lost");$("foundPanel").classList.toggle("hidden",tab!=="found");}));
  if(!token){window.top.location.replace("/index.html");return;}
  if(isOfficer())$("foundFormWrap").classList.remove("hidden");
  Promise.all([loadLost(),loadFound()]).catch(e=>msg($("pageMessage"),e.message,true));
})();