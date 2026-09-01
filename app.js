
(() => {
  const API_URL = "https://script.google.com/macros/s/AKfycbzAlT9T_i3zeMp-c6vl4y38DyHhg2fRQH06WMmmLxquTrpTcBhzF0fYqTclMoMuPyZ-hQ/exec";
  const CACHE_KEY = "project_crm_shared_cache_v24";
  const sessionKey = "project_crm_shared_session_v24";

  const seed = {
    users: [
      {id:"u_admin",name:"Главный администратор",login:"admin",password:"admin123",role:"admin",phone:"",active:true},
      
      {id:"u_view",name:"Наблюдатель",login:"viewer",password:"viewer123",role:"viewer",phone:"",active:true}
    ],
    defaultStages:["Начальная","Развитие","Слияние","Залив. инф","Пред. предлог","72 часа"],
    blockOptions:["Блок 1","Блок 2","Блок 3","Блок 4","Блок 5"],
    managerConfigs:{
      "u_mgr1":{
        notebook:"",
        messages:["Сообщение от начальства №1","Сообщение от начальства №2"],
        thesisTemplates:[
          {id:"tt_1",stageIndex:0,text:"Первичное знакомство"},
          {id:"tt_2",stageIndex:1,text:"Цели и планы"},
          {id:"tt_3",stageIndex:1,text:"Текущая занятость"}
        ],
        blockTemplates:[
          {id:"bt_1",stageIndex:0,text:"Путешествия"},
          {id:"bt_2",stageIndex:1,text:"Окружение"}
        ]
      }
    },
    clients:[
      {id:"c1",number:1,name:"Иван",gender:"male",block:"",blockReaction:"",blockRecords:[{block:"Блок 1",reaction:"Положительная",comments:[{ts:"2026-08-30T18:21:00",text:"Хорошо воспринял информацию по первому блоку.",authorName:"Александр"}]},{block:"Блок 2",reaction:"Негативная",comments:[{ts:"2026-08-31T10:15:00",text:"По второму блоку возникли возражения.",authorName:"Александр"}]}],discussion:"Познакомились, обсудили цели",notes:"Перезвонить после выходных",nick:"ivan",age:"34",managerId:"u_mgr1",profession:"Предприниматель",interests:"Путешествия",startDate:"2026-08-23",lastContact:"2026-08-30",nextContact:"2026-09-01",stageIndex:2,stages:["Начальная","Развитие","Слияние","Залив. инф","Пред. предлог","72 часа"],deleted:false,history:[
        {ts:"2026-08-30T18:21:00",text:"Добавлен комментарий: «Обсудили дополнительный доход»"},
        {ts:"2026-08-28T15:07:00",text:"Создан проект"}
      ]},
      {id:"c2",number:2,name:"Анна",gender:"female",block:"",blockReaction:"",blockRecords:[{block:"Блок 1",reaction:"Нейтральная",comments:[{ts:"2026-08-27T12:30:00",text:"Первичная реакция без явного интереса.",authorName:"Александр"}]}],discussion:"Обсудили текущую ситуацию",notes:"Вернуться к разговору позже",nick:"anna",age:"29",managerId:"u_mgr1",profession:"Маркетолог",interests:"Спорт",startDate:"2026-08-27",lastContact:"2026-08-30",nextContact:"2026-09-02",stageIndex:4,stages:["Начальная","Развитие","Слияние","Залив. инф","Пред. предлог","72 часа"],deleted:false,history:[{ts:"2026-08-27T12:00:00",text:"Создан проект"}]}
    ],
    audit:[]
  };


  let db = JSON.parse(JSON.stringify(seed));
  let session = loadSession();
  let syncing = false;
  let realtimeTimer=null;
  function stopRealtime(){if(realtimeTimer){clearInterval(realtimeTimer);realtimeTimer=null;}}

  function loadSession(){
    try{ return JSON.parse(localStorage.getItem(sessionKey)||"null") }catch(e){ return null }
  }
  function setSession(s){
    session=s;
    localStorage.setItem(sessionKey,JSON.stringify(s));
    render();
  }
  function logout(){
    stopRealtime();
    session=null;
    localStorage.removeItem(sessionKey);
    render();
  }
  async function api(action,payload={}){
    const r=await fetch(API_URL,{
      method:"POST",
      headers:{"Content-Type":"text/plain;charset=utf-8"},
      body:JSON.stringify({action,token:session?.token||"",...payload})
    });
    const data=await r.json().catch(()=>({}));
    if(!r.ok || data.ok===false) throw new Error(data.error||"Ошибка сервера");
    return data;
  }
  function isUnknownActionError(e){
    const s=String(e?.message||e||"").toLowerCase();
    return s.includes("неизвест") || s.includes("unknown action");
  }

  // Совместимость с предыдущим развёртыванием Apps Script.
  // Если новые точечные действия ещё не опубликованы, сайт автоматически
  // использует старые getState/saveState вместо показа ошибки.
  async function getManagerDataCompat(managerId){
    try{
      return await api("getManagerData",{managerId});
    }catch(e){
      if(!isUnknownActionError(e)) throw e;
      const data=await api("getState");
      if(data.state){
        db=data.state;
        localStorage.setItem(CACHE_KEY,JSON.stringify(db));
      }
      return {ok:true,config:managerConfig(managerId)};
    }
  }

  async function saveNotebookCompat(text,clientUpdatedAt){
    try{
      return await api("saveNotebook",{text,clientUpdatedAt});
    }catch(e){
      if(!isUnknownActionError(e)) throw e;
      const me=db.users.find(u=>u.id===session.userId);
      const cfg=managerConfig(me.id);
      cfg.notebook=String(text||"");
      cfg.notebookUpdatedAt=clientUpdatedAt||nowISO();
      const ok=await syncRemote(false);
      if(!ok) throw new Error("Не удалось сохранить блокнот");
      return {ok:true,config:managerConfig(me.id)};
    }
  }

  async function sendMessageCompat(managerId,text){
    try{
      return await api("sendMessage",{managerId,text});
    }catch(e){
      if(!isUnknownActionError(e)) throw e;
      // Подтягиваем последнюю базу перед записью, чтобы не затереть чужие данные.
      const stateData=await api("getState");
      if(stateData.state) db=stateData.state;
      const me=db.users.find(u=>u.id===session.userId);
      const cfg=managerConfig(managerId);
      const kind=me.role==="admin"?"admin":"observer";
      cfg.inbox[kind]={
        id:uid("msg_"),
        text:String(text||""),
        sentAt:nowISO(),
        readAt:""
      };
      localStorage.setItem(CACHE_KEY,JSON.stringify(db));
      const ok=await syncRemote(false);
      if(!ok) throw new Error("Не удалось сохранить сообщение");
      return {ok:true,config:managerConfig(managerId)};
    }
  }

  async function markMessageReadCompat(kind,messageId){
    try{
      return await api("markMessageRead",{kind,messageId});
    }catch(e){
      if(!isUnknownActionError(e)) throw e;
      const me=db.users.find(u=>u.id===session.userId);
      const cfg=managerConfig(me.id);
      const msg=cfg.inbox[kind];
      if(msg && String(msg.id||"")===String(messageId||"")){
        msg.readAt=nowISO();
        await syncRemote(false);
      }
      return {ok:true,config:managerConfig(me.id)};
    }
  }

  async function saveManagerSettingsAtomic(managerId){
    const cfg=managerConfig(managerId);
    const payload={
      managerId,
      progressScaleTitle:cfg.progressScaleTitle,
      funnelStages:cfg.funnelStages,
      thesisTemplates:cfg.thesisTemplates,
      blockTemplates:cfg.blockTemplates
    };
    try{
      const data=await api("saveManagerSettings",payload);
      if(data.state){
        db=data.state;
        localStorage.setItem(CACHE_KEY,JSON.stringify(db));
      }else if(data.config){
        db.managerConfigs=db.managerConfigs||{};
        db.managerConfigs[managerId]=data.config;
        localStorage.setItem(CACHE_KEY,JSON.stringify(db));
      }
      return true;
    }catch(e){
      if(!isUnknownActionError(e)) throw e;
      // Совместимость со старым backend.
      syncManagerTemplates(managerId);
      return await syncRemote(false);
    }
  }

  async function saveChecklistAtomic(projectId,type,itemId,done){
    try{
      const data=await api("saveChecklistItem",{projectId,type,itemId,done:!!done});
      if(data.project){
        const idx=(db.clients||[]).findIndex(x=>x.id===projectId);
        if(idx>=0) db.clients[idx]=data.project;
        localStorage.setItem(CACHE_KEY,JSON.stringify(db));
      }
      return true;
    }catch(e){
      if(!isUnknownActionError(e)) throw e;
      return await syncRemote(false);
    }
  }

  async function fetchState(){
    if(!session?.token) return false;
    try{
      const data=await api("getState");
      db=data.state;
      localStorage.setItem(CACHE_KEY,JSON.stringify(db));
      return true;
    }catch(e){
      console.error(e);
      if(String(e.message||"").toLowerCase().includes("сесс")) logout();
      return false;
    }
  }
  let syncQueued=false;
  let syncRenderQueued=false;
  async function syncRemote(renderAfter=false){
    if(!session?.token){
      if(renderAfter) render();
      return false;
    }
    localStorage.setItem(CACHE_KEY,JSON.stringify(db));

    if(syncing){
      syncQueued=true;
      syncRenderQueued=syncRenderQueued||renderAfter;
      return true;
    }

    syncing=true;
    let ok=true;
    try{
      do{
        syncQueued=false;
        const snapshot=JSON.parse(JSON.stringify(db));
        localStorage.setItem(CACHE_KEY,JSON.stringify(snapshot));
        const data=await api("saveState",{state:snapshot});
        // Если во время запроса пользователь успел сделать ещё изменения,
        // не заменяем локальный db более старым ответом сервера.
        if(!syncQueued && data.state) db=data.state;
        localStorage.setItem(CACHE_KEY,JSON.stringify(db));
      }while(syncQueued);
    }catch(e){
      ok=false;
      console.error("Sync error:",e);
    }finally{
      syncing=false;
      const shouldRender=renderAfter||syncRenderQueued;
      syncRenderQueued=false;
      if(shouldRender) render();
    }
    return ok;
  }
  function save(){ syncRemote(true); }


  const app = document.getElementById("app");
  const esc = s => String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  const fmtDate = d => d ? new Date(d+"T00:00:00").toLocaleDateString("ru-RU") : "—";
  const daysBetween = d => {
    if(!d) return 0;
    const a = new Date(d+"T00:00:00"), b = new Date();
    return Math.max(0, Math.floor((b-a)/86400000)+1);
  };
  const uid = p => p + Math.random().toString(36).slice(2,10);
  const nowISO = () => new Date().toISOString();

  function projectStages(c){
    if(!c) return ["Начальная","Развитие","Слияние","Залив. инф","Пред. предлог","72 часа"];
    const cfg=managerConfig(c.managerId);
    const stages=Array.isArray(cfg.funnelStages)&&cfg.funnelStages.length
      ? cfg.funnelStages
      : ["Начальная","Развитие","Слияние","Залив. инф","Пред. предлог","72 часа"];
    return stages;
  }

  function stageMilestonePercent(c, stageIndex){
    const n=Math.max(1,projectStages(c).length);
    if(n<=1) return 0;
    return Math.round((Math.max(0,Math.min(stageIndex,n-1))/(n-1))*100);
  }

  function managerConfig(managerId){
    db.managerConfigs=db.managerConfigs&&typeof db.managerConfigs==="object"?db.managerConfigs:{};
    if(!db.managerConfigs[managerId]){
      db.managerConfigs[managerId]={
        notebook:"",notebookUpdatedAt:"",
        inbox:{
          admin:{id:"",text:"",sentAt:"",readAt:""},
          observer:{id:"",text:"",sentAt:"",readAt:""}
        },
        progressScaleTitle:"Шкала прогресса",
        funnelStages:["Начальная","Развитие","Слияние","Залив. инф","Пред. предлог","72 часа"],
        thesisTemplates:[],blockTemplates:[]
      };
    }
    const cfg=db.managerConfigs[managerId];
    cfg.notebook=String(cfg.notebook||"");
    cfg.notebookUpdatedAt=String(cfg.notebookUpdatedAt||"");
    cfg.progressScaleTitle=String(cfg.progressScaleTitle||"Шкала прогресса");
    cfg.funnelStages=Array.isArray(cfg.funnelStages)&&cfg.funnelStages.length
      ? cfg.funnelStages.map(x=>String(x||"").trim()).filter(Boolean)
      : ["Начальная","Развитие","Слияние","Залив. инф","Пред. предлог","72 часа"];

    // Миграция со старого поля messages -> новый двойной inbox.
    cfg.inbox=cfg.inbox&&typeof cfg.inbox==="object"?cfg.inbox:{};
    const legacy=Array.isArray(cfg.messages)?cfg.messages:["",""];
    ["admin","observer"].forEach((key,idx)=>{
      const old=cfg.inbox[key]&&typeof cfg.inbox[key]==="object"?cfg.inbox[key]:{};
      cfg.inbox[key]={
        id:String(old.id||""),
        text:String(old.text||legacy[idx]||""),
        sentAt:String(old.sentAt||((idx===0&&cfg.lastMessageAt)?cfg.lastMessageAt:"")),
        readAt:String(old.readAt||"")
      };
    });
    cfg.thesisTemplates=Array.isArray(cfg.thesisTemplates)?cfg.thesisTemplates:[];
    cfg.blockTemplates=Array.isArray(cfg.blockTemplates)?cfg.blockTemplates:[];
    return cfg;
  }

  function projectTheses(c){
    c.theses=Array.isArray(c.theses)?c.theses:[];
    return c.theses;
  }

  function projectBlocks(c){
    c.blockChecks=Array.isArray(c.blockChecks)?c.blockChecks:[];
    return c.blockChecks;
  }

  function syncProjectTemplates(c){
    const cfg=managerConfig(c.managerId);
    let changed=false;

    cfg.thesisTemplates.forEach(tpl=>{
      let row=projectTheses(c).find(x=>x.templateId===tpl.id);
      if(!row){
        projectTheses(c).push({
          id:uid("th_"),templateId:tpl.id,stageIndex:0,
          text:tpl.text||"",done:false,createdAt:nowISO(),updatedAt:nowISO(),
          authorId:"template",authorName:"Шаблон"
        });
        changed=true;
      }else{
        if(row.text!==tpl.text || Number(row.stageIndex)!==0){ row.text=tpl.text||""; row.stageIndex=0;
          changed=true;
        }
      }
    });

    cfg.blockTemplates.forEach(tpl=>{
      let row=projectBlocks(c).find(x=>x.templateId===tpl.id);
      if(!row){
        projectBlocks(c).push({
          id:uid("bc_"),templateId:tpl.id,stageIndex:0,
          text:tpl.text||"",done:false,createdAt:nowISO(),updatedAt:nowISO()
        });
        changed=true;
      }else{
        if(row.text!==tpl.text || Number(row.stageIndex)!==0){ row.text=tpl.text||""; row.stageIndex=0;
          changed=true;
        }
      }
    });
    return changed;
  }

  function syncManagerTemplates(managerId){
    const cfg=managerConfig(managerId);
    const thesisIds=new Set(cfg.thesisTemplates.map(x=>x.id));
    const blockIds=new Set(cfg.blockTemplates.map(x=>x.id));
    (db.clients||[]).filter(c=>c.managerId===managerId).forEach(c=>{
      c.theses=projectTheses(c).filter(x=>!x.templateId || thesisIds.has(x.templateId));
      c.blockChecks=projectBlocks(c).filter(x=>!x.templateId || blockIds.has(x.templateId));
      syncProjectTemplates(c);
    });
  }

  function globalThesisStats(c){
    const rows=projectTheses(c);
    return {total:rows.length,done:rows.filter(t=>t.done!==false).length};
  }

  function globalBlockStats(c){
    const rows=projectBlocks(c);
    return {total:rows.length,done:rows.filter(t=>t.done!==false).length};
  }

  function globalChecklistStats(c){
    const t=globalThesisStats(c), b=globalBlockStats(c);
    return {total:t.total+b.total,done:t.done+b.done,theses:t,blocks:b};
  }

  function checklistItemPercent(c){
    const stats=globalChecklistStats(c);
    return stats.total ? 100/stats.total : 0;
  }

  function projectProgress(c){
    syncProjectTemplates(c);
    const stats=globalChecklistStats(c);
    if(!stats.total) return 0;
    return Math.round((stats.done/stats.total)*1000)/10;
  }

  function derivedStageIndex(c){
    const n=Math.max(1,projectStages(c).length);
    const p=projectProgress(c);
    if(n<=1) return 0;
    return Math.max(0,Math.min(n-1,Math.floor((p/100)*n)));
  }

  function inboxUnread(msg){
    if(!msg || !msg.text || !msg.sentAt) return 0;
    if(!msg.readAt) return 1;
    return new Date(msg.readAt).getTime() < new Date(msg.sentAt).getTime() ? 1 : 0;
  }

  function inboxTitle(kind){
    return kind==="admin" ? "От главного админа" : "От наблюдателя";
  }

  function geoLabel(c){
    const type=c.geoType||"";
    if(type==="russia") return `🇷🇺 Классика${c.region?` · ${esc(c.region)}`:""}`;
    if(type==="belarus") return "🇧🇾 Усы";
    if(type==="europe") return "🌈 Радуга";
    if(type==="other") return `📍 Иное${c.region?` · ${esc(c.region)}`:""}`;
    return "📍 Не указано";
  }

  function pipeline(c){
    const stages=projectStages(c);
    const n = stages.length;
    const idx = derivedStageIndex(c);
    const overall = projectProgress(c);
    const pct = overall*0.94;
    return `<div class="pipeline">
      <div class="progress-summary">
        <div><b>${esc(managerConfig(c.managerId).progressScaleTitle||"Шкала прогресса")}</b><span class="muted small"> Автоматически: отмеченные тезисы + блоки</span></div>
        <div class="progress-percent">${overall}%</div>
      </div>
      <div class="pipe-track" style="--count:${n};--progress:${pct}%">
        <div class="pipe-progress"></div>
        ${stages.map((s,i)=>`<div class="stage ${i<idx?"done":i===idx?"current":""}">
          <div class="dot"></div>
          <div class="stage-name">${esc(s)}</div>
        </div>`).join("")}
      </div>
    </div>`;
  }

  function loginView(){
    app.innerHTML = `<div class="login-wrap"><div class="login-card">
      <div class="login-logo"><img class="login-sticker" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj4KPHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiIHJ4PSIyNCIgZmlsbD0iIzI1MzI0NiIvPgo8Y2lyY2xlIGN4PSI1MCIgY3k9IjM3IiByPSIxNyIgZmlsbD0iI2Y1OWUwYiIvPgo8cGF0aCBkPSJNMjAgODVjNC0yMCAxNi0zMCAzMC0zMHMyNiAxMCAzMCAzMCIgZmlsbD0iI2Y1OWUwYiIvPgo8L3N2Zz4=" alt="">Цитадель</div>
      <div class="muted" style="margin-bottom:22px">Система управления проектами</div>
      <form id="loginForm">
        <div class="field" style="margin-bottom:12px"><label>Логин</label><input name="login" required autocomplete="username"></div>
        <div class="field" style="margin-bottom:16px"><label>Пароль</label><input type="password" name="password" required autocomplete="current-password"></div>
        <button class="btn primary" style="width:100%">Войти</button>
      </form>
      <div id="loginErr" class="small" style="color:#b91c1c;margin-top:12px"></div>
    </div></div>`;
    document.getElementById("loginForm").onsubmit = async e => {
      e.preventDefault();
      const fd=new FormData(e.target);
      const login=String(fd.get("login")||"").trim();
      const password=String(fd.get("password")||"");
      const err=document.getElementById("loginErr");
      err.textContent="Проверка...";
      try{
        const data=await api("login",{login,password});
        if(!data || !data.token) throw new Error(data?.error||"Сервер не вернул токен входа");
        if(data.state && Array.isArray(data.state.users)){
          db=data.state;
        }else{
          const stateData=await api("getState",{token:data.token});
          if(!stateData?.state || !Array.isArray(stateData.state.users)){
            throw new Error("Общая база пользователей не настроена. Обновите Apps Script до версии v24.");
          }
          db=stateData.state;
        }
        const matchedUser =
          (data.user && data.user.id ? data.user : null) ||
          (db.users||[]).find(u=>String(u.login||"").trim().toLowerCase()===login.trim().toLowerCase());

        if(!matchedUser || !matchedUser.id) throw new Error("Пользователь найден, но у него отсутствует ID");
        session={token:data.token,userId:matchedUser.id};
        localStorage.setItem(sessionKey,JSON.stringify(session));
        localStorage.setItem(CACHE_KEY,JSON.stringify(db));
        render();
      }catch(ex){
        err.textContent=ex.message||"Неверный логин или пароль.";
      }
    };
  }

  function shell(content){
    const me = db.users.find(u=>u.id===session.userId);
    if(!me){logout();return}
    const menu = (me.role==="admin" || me.role==="viewer")
      ? [["dashboard","⌂","Главная"],["managers","◉","Менеджеры"],["allclients","▦","Проекты"],["trash","⌫","Корзина"],...(me.role==="admin"?[["users","♙","Пользователи"]]:[])]
      : [["clients","⌂","Главная"],["clients","▦","Проекты"],["notebook","✎","Блокнот"]];
    const theme = localStorage.getItem("project_theme") || "light";
    document.documentElement.setAttribute("data-theme", theme);
    app.innerHTML = `<div class="app-shell">
      <aside class="sidebar">
        <div class="side-brand"><img class="brand-sticker" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj4KPHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiIHJ4PSIyNCIgZmlsbD0iIzI1MzI0NiIvPgo8Y2lyY2xlIGN4PSI1MCIgY3k9IjM3IiByPSIxNyIgZmlsbD0iI2Y1OWUwYiIvPgo8cGF0aCBkPSJNMjAgODVjNC0yMCAxNi0zMCAzMC0zMHMyNiAxMCAzMCAzMCIgZmlsbD0iI2Y1OWUwYiIvPgo8L3N2Zz4=" alt=""><span>Цитадель</span></div>
        <div class="side-user">
          <div class="avatar">${me.avatar?`<img src="${me.avatar}" alt="">`:esc((me.name||"П").charAt(0).toUpperCase())}</div>
          <div><b>${esc(me.name)}</b><span>${roleName(me.role)}</span></div>
        </div>
        <nav class="side-nav">
          ${menu.map(([id,ico,title])=>`<button class="side-link" data-nav="${id}"><span>${ico}</span>${title}</button>`).join("")}
        </nav>
        <div class="side-bottom">
          <button id="themeBtn" class="side-link"><span>${theme==="dark"?"☀":"☾"}</span>${theme==="dark"?"Светлая тема":"Тёмная тема"}</button>
          <button id="logoutBtn" class="side-link"><span>↪</span>Выйти</button>
        </div>
      </aside>
      <section class="content-shell">
        <header class="mobile-top">
          <div class="side-brand"><img class="brand-sticker" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj4KPHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiIHJ4PSIyNCIgZmlsbD0iIzI1MzI0NiIvPgo8Y2lyY2xlIGN4PSI1MCIgY3k9IjM3IiByPSIxNyIgZmlsbD0iI2Y1OWUwYiIvPgo8cGF0aCBkPSJNMjAgODVjNC0yMCAxNi0zMCAzMC0zMHMyNiAxMCAzMCAzMCIgZmlsbD0iI2Y1OWUwYiIvPgo8L3N2Zz4=" alt=""><span>Цитадель</span></div>
          <div class="mobile-top-actions">
            <button id="mobileTheme" class="btn ghost mobile-icon-btn" aria-label="Тема">${theme==="dark"?"☀":"☾"}</button>
            <button id="mobileLogout" class="btn ghost mobile-logout-btn">Выйти</button>
          </div>
        </header>
        <nav class="mobile-admin-nav">
          ${menu.map(([id,ico,title])=>`<button class="mobile-admin-link" data-nav="${id}"><span class="mobile-admin-ico">${ico}</span><span>${title}</span></button>`).join("")}
        </nav>
        <main class="main">${content}<footer class="footer">© 2026 Цитадель. Все права защищены.</footer></main>
      </section>
    </div>`;
    const toggleTheme=()=>{
      const cur=document.documentElement.getAttribute("data-theme")==="dark"?"dark":"light";
      const next=cur==="dark"?"light":"dark";
      localStorage.setItem("project_theme",next);
      document.documentElement.setAttribute("data-theme",next);
      render();
    };
    document.getElementById("themeBtn").onclick=toggleTheme;
    document.getElementById("mobileTheme").onclick=toggleTheme;
    document.getElementById("logoutBtn").onclick=logout;
    document.getElementById("mobileLogout").onclick=logout;
  }
  function roleName(r){ return r==="admin"?"Администратор":r==="manager"?"Менеджер":"Наблюдатель"; }

  function nav(active, me){
    const tabs = me.role==="admin"
      ? [["dashboard","Обзор"],["managers","Менеджеры"],["allclients","Все проекты"],["users","Пользователи"]]
      : me.role==="viewer"
        ? [["dashboard","Обзор"],["managers","Менеджеры"],["allclients","Все проекты"]]
        : [["clients","Мои проекты"],["notebook","Блокнот"]];
    return `<div class="tabs">${tabs.map(([id,t])=>`<button class="tab ${active===id?"active":""}" data-nav="${id}">${t}</button>`).join("")}</div>`;
  }

  function wireNav(){
    document.querySelectorAll("[data-nav]").forEach(b=>b.onclick=()=>route(b.dataset.nav));
  }

  function projectCard(c, me){
    const manager = db.users.find(u=>u.id===c.managerId);
    const stages=projectStages(c);
    const stage = stages[derivedStageIndex(c)] || "—";
    return `<div class="card client-card" data-project="${c.id}" style="cursor:pointer">
      <div class="client-head">
        <div><div class="client-title">Проект №${String(c.number).padStart(3,"0")} · ${esc(c.name)}</div>
        <div class="meta"><span>В общении: ${daysBetween(c.startDate)} дн.</span><span>Менеджер: ${esc(manager?.name||"—")}</span><span>${c.gender==="male"?"Твёрдый":c.gender==="female"?"Мягкий":"Пол не указан"} · ${geoLabel(c)}</span></div></div>
        <span class="pill orange">${esc(stage)}</span>
      </div>
      ${pipeline(c)}
      ${(me.role==="admin"||me.role==="manager"||me.role==="viewer")?`<div class="card-actions-inline"><button class="btn ghost" data-dialog-export="${c.id}">Последняя выгрузка</button></div>`:""}
    </div>`;
  }

  async function managerView(){
    stopRealtime();

    // Сначала обязательно получаем свежие настройки наблюдателя с сервера.
    // Благодаря этому менеджер сразу видит актуальные стадии, тезисы, блоки и название шкалы.
    await fetchState();

    const me = db.users.find(u=>u.id===session.userId);
    if(!me || me.role!=="manager") return render();

    const cfg=managerConfig(me.id);
    syncManagerTemplates(me.id);

    const clients = db.clients.filter(c=>c.managerId===me.id && !c.deleted);
    shell(`${nav("clients",me)}
      <div class="manager-message-bar">
        <button class="boss-message-btn" data-inbox-kind="admin">
          <span>✉ От главного админа</span>
          ${inboxUnread(cfg.inbox.admin)?'<span class="unread-badge">1</span>':""}
        </button>
        <button class="boss-message-btn" data-inbox-kind="observer">
          <span>✉ От наблюдателя</span>
          ${inboxUnread(cfg.inbox.observer)?'<span class="unread-badge">1</span>':""}
        </button>
      </div>
      <div class="section-head"><div><h1>Мои проекты</h1><p class="muted">Всего проектов: ${clients.length}</p></div>
      ${me.role==="manager"?'<button id="addClient" class="btn primary">+ Добавить проект</button>':""}</div>
      <div class="toolbar"><input id="q" placeholder="Поиск по имени или номеру"><select id="stageFilter"><option value="">Все стадии</option>${cfg.funnelStages.map((s,i)=>`<option value="${i}">${esc(s)}</option>`).join("")}</select></div>
      <div id="clientList" class="list">${clients.length?clients.map(c=>projectCard(c,me)).join(""):'<div class="empty">Проектов пока нет</div>'}</div>`);
    wireNav();
    if(me.role==="manager") document.getElementById("addClient").onclick=()=>openClientEditor(null);
    const applyManagerConfig=(config)=>{
      if(!config)return;
      db.managerConfigs=db.managerConfigs||{};
      db.managerConfigs[me.id]=config;
      localStorage.setItem(CACHE_KEY,JSON.stringify(db));
    };

    const paintInboxBadges=()=>{
      const liveCfg=managerConfig(me.id);
      document.querySelectorAll("[data-inbox-kind]").forEach(btn=>{
        const kind=btn.dataset.inboxKind;
        const unread=inboxUnread(liveCfg.inbox[kind]);
        let badge=btn.querySelector(".unread-badge");
        if(unread && !badge){
          badge=document.createElement("span");
          badge.className="unread-badge";
          badge.textContent="1";
          btn.appendChild(badge);
        }else if(!unread && badge){
          badge.remove();
        }
      });
    };

    const managerSettingsSignature=()=>{
      const live=managerConfig(me.id);
      return JSON.stringify({
        funnelStages:live.funnelStages||[],
        progressScaleTitle:live.progressScaleTitle||"",
        thesisTemplates:(live.thesisTemplates||[]).map(x=>[x.id,x.text]),
        blockTemplates:(live.blockTemplates||[]).map(x=>[x.id,x.text])
      });
    };

    let lastManagerSettingsSignature=managerSettingsSignature();

    const refreshManagerData=async()=>{
      try{
        const before=lastManagerSettingsSignature;
        const ok=await fetchState();
        if(!ok)return;

        const freshMe=db.users.find(u=>u.id===session.userId);
        if(!freshMe || freshMe.role!=="manager") return render();

        syncManagerTemplates(freshMe.id);
        const after=managerSettingsSignature();

        // Если Наблюдатель поменял стадии/шкалу/тезисы/блоки,
        // сразу полностью перерисовываем страницу менеджера.
        if(after!==before){
          lastManagerSettingsSignature=after;
          return managerView();
        }

        lastManagerSettingsSignature=after;
        paintInboxBadges();
      }catch(e){ console.warn("manager refresh",e); }
    };

    document.querySelectorAll("[data-inbox-kind]").forEach(btn=>btn.onclick=async()=>{
      const kind=btn.dataset.inboxKind;
      btn.disabled=true;
      try{
        const data=await getManagerDataCompat(me.id);
        applyManagerConfig(data.config);
        const cfgNow=managerConfig(me.id);
        const msg=cfgNow.inbox[kind]||{id:"",text:"",sentAt:"",readAt:""};
        const text=String(msg.text||"").trim()||"Новых сообщений нет.";
        const when=msg.sentAt?new Date(msg.sentAt).toLocaleString("ru-RU"):"";

        if(msg.id && msg.text && inboxUnread(msg)){
          const readData=await markMessageReadCompat(kind,msg.id);
          applyManagerConfig(readData.config);
        }

        const m=document.createElement("div");m.className="modal";
        m.innerHTML=`<div class="modal-card small-modal sms-modal">
          <div class="modal-head">
            <div><h2>${esc(inboxTitle(kind))}</h2>${when?`<div class="muted small">${esc(when)}</div>`:""}</div>
            <button class="icon-btn" data-close>×</button>
          </div>
          <div class="sms-bubble">${esc(text)}</div>
          <div class="actions"><button class="btn primary" data-close>Прочитано</button></div>
        </div>`;
        document.body.appendChild(m);
        m.querySelectorAll("[data-close]").forEach(x=>x.onclick=()=>{m.remove();paintInboxBadges();});
      }catch(e){
        alert("Не удалось получить сообщение. Проверьте соединение и повторите.");
      }finally{
        btn.disabled=false;
      }
    });

    refreshManagerData();
    realtimeTimer=setInterval(refreshManagerData,5000);
    wireProjectCards();
    const q=document.getElementById("q"), sf=document.getElementById("stageFilter");
    const filt=()=> {
      const term=q.value.toLowerCase().trim(), st=sf.value;
      const f=clients.filter(c=>(!term || c.name.toLowerCase().includes(term)||String(c.number).includes(term)) && (st===""||String(derivedStageIndex(c))===st));
      document.getElementById("clientList").innerHTML=f.length?f.map(c=>projectCard(c,me)).join(""):'<div class="empty">Ничего не найдено</div>';
      wireProjectCards();
    };
    q.oninput=filt; sf.onchange=filt;
  }

  let notebookFileHandle=null;
  let notebookSaveTimer=null;

  async function writeNotebookFile(text){
    if(!notebookFileHandle) return;
    try{
      const writable=await notebookFileHandle.createWritable();
      await writable.write(text);
      await writable.close();
    }catch(e){ console.warn("TXT autosave:",e); }
  }

  function downloadTxt(name,text){
    const blob=new Blob([text],{type:"text/plain;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;a.download=name;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),500);
  }

  async function notebookView(){
    stopRealtime();
    const me=db.users.find(u=>u.id===session.userId);
    if(!me || me.role!=="manager") return managerView();

    const draftKey=`citadel_notebook_draft_${me.id}`;
    try{
      const data=await getManagerDataCompat(me.id);
      if(data.config){
        db.managerConfigs=db.managerConfigs||{};
        db.managerConfigs[me.id]=data.config;
        localStorage.setItem(CACHE_KEY,JSON.stringify(db));
      }
    }catch(e){ console.warn("notebook load",e); }

    const cfg=managerConfig(me.id);
    let startText=cfg.notebook||"";
    try{
      const draft=JSON.parse(localStorage.getItem(draftKey)||"null");
      if(draft && draft.text!=null){
        const draftTs=Date.parse(draft.ts||"")||0;
        const serverTs=Date.parse(cfg.notebookUpdatedAt||"")||0;
        if(draftTs>serverTs) startText=String(draft.text);
      }
    }catch(e){}

    shell(`${nav("notebook",me)}
      <div class="section-head"><div><h1>Мой блокнот</h1><p class="muted">Хранится в общей базе Цитадели и остаётся после выхода и повторного входа.</p></div></div>
      <div class="card notebook-card">
        <div class="notebook-tools">
          <button class="btn primary" id="saveNotebookNow">Сохранить сейчас</button>
          <button class="btn ghost" id="downloadTxt">Скачать TXT</button>
          <span class="muted small" id="notebookStatus">${cfg.notebookUpdatedAt?`Последнее сохранение: ${new Date(cfg.notebookUpdatedAt).toLocaleString("ru-RU")}`:"Сохранено"}</span>
        </div>
        <textarea id="managerNotebook" class="notebook-textarea" placeholder="Личные рабочие заметки...">${esc(startText)}</textarea>
      </div>`);
    wireNav();

    const ta=document.getElementById("managerNotebook");
    const status=document.getElementById("notebookStatus");
    const saveBtn=document.getElementById("saveNotebookNow");
    let saving=false,saveAgain=false;

    const persistNotebook=async()=>{
      if(saving){saveAgain=true;return true;}
      saving=true;
      const text=ta.value;
      const clientTs=nowISO();
      localStorage.setItem(draftKey,JSON.stringify({text,ts:clientTs}));
      status.textContent="Сохраняю...";
      saveBtn.disabled=true;
      let ok=false;
      try{
        const data=await saveNotebookCompat(text,clientTs);
        if(data.config){
          db.managerConfigs=db.managerConfigs||{};
          db.managerConfigs[me.id]=data.config;
          localStorage.setItem(CACHE_KEY,JSON.stringify(db));
          localStorage.setItem(draftKey,JSON.stringify({
            text:data.config.notebook||"",
            ts:data.config.notebookUpdatedAt||clientTs
          }));
        }
        ok=true;
        status.textContent=`Сохранено: ${new Date(data.config?.notebookUpdatedAt||clientTs).toLocaleString("ru-RU")}`;
      }catch(e){
        status.textContent="Ошибка сохранения — текст оставлен локально";
        console.error(e);
      }finally{
        saving=false;
        saveBtn.disabled=false;
      }
      if(saveAgain){saveAgain=false;return persistNotebook();}
      return ok;
    };

    ta.oninput=()=>{
      const ts=nowISO();
      localStorage.setItem(draftKey,JSON.stringify({text:ta.value,ts}));
      status.textContent="Сохраняю изменения...";
      clearTimeout(notebookSaveTimer);
      notebookSaveTimer=setTimeout(()=>persistNotebook(),450);
    };
    ta.onblur=()=>persistNotebook();
    saveBtn.onclick=()=>persistNotebook();
    document.getElementById("downloadTxt").onclick=()=>downloadTxt(`Цитадель_${me.name}_блокнот.txt`,ta.value);

    // Если локальный черновик был свежее сервера — сразу отправляем его в систему.
    if(startText!==String(cfg.notebook||"")) persistNotebook();
  }

  function adminDashboard(){
    const me = db.users.find(u=>u.id===session.userId);
    const managers=db.users.filter(u=>u.role==="manager");
    const liveProjects=db.clients.filter(c=>!c.deleted);
    const active=liveProjects.filter(c=>derivedStageIndex(c)<projectStages(c).length-1).length;
    shell(`${nav("dashboard",me)}
      <div class="section-head"><div><h1>Обзор</h1><p class="muted">Общая картина по команде</p></div></div>
      <div class="stats">
        <div class="stat"><span class="muted">Менеджеры</span><b>${managers.length}</b></div>
        <div class="stat"><span class="muted">Все проекты</span><b>${liveProjects.length}</b></div>
        <div class="stat"><span class="muted">В работе</span><b>${active}</b></div>
        <div class="stat"><span class="muted">Завершено</span><b>${liveProjects.length-active}</b></div>
      </div>
      <div class="card"><h2 style="margin-top:0">Стадии воронки</h2>
        <div class="stage-editor" id="stageEditor">${db.defaultStages.map((s,i)=>`<span class="stage-chip">${i+1}. ${esc(s)}</span>`).join("")}</div>
        <div class="small muted" style="margin-top:10px">Стадии задаёт наблюдатель один раз в настройках менеджера.</div>
      </div>
      <div class="card" style="margin-top:16px">
        <h2 style="margin-top:0">Список блоков</h2>
        <p class="muted">Эти варианты появляются в раскрывающемся поле «Блок» внутри проекта.</p>
        <div class="stage-editor" id="blockList">
          ${(db.blockOptions||[]).map((s,i)=>`<span class="stage-chip">${esc(s)} <button data-remove-block="${i}" title="Удалить">×</button></span>`).join("")}
        </div>
        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
          <input id="newBlockName" placeholder="Название нового блока" style="max-width:320px">
          <button class="btn primary" id="addBlockOption">+ Добавить блок</button>
        </div>
      </div>`);
    wireNav();
    document.querySelectorAll("[data-delete-manager]").forEach(btn=>btn.onclick=async()=>{
      const managerId=btn.dataset.deleteManager;
      const manager=db.users.find(u=>u.id===managerId);
      if(!manager)return;
      if(!confirm(`Полностью удалить менеджера «${manager.name}» и все его проекты/настройки? Это действие нельзя отменить.`)) return;
      btn.disabled=true;
      btn.textContent="Удаляю...";
      try{
        const data=await api("deleteManager",{managerId});
        if(data.state){
          db=data.state;
          localStorage.setItem(CACHE_KEY,JSON.stringify(db));
        }else{
          await fetchState();
        }
        render();
      }catch(e){
        btn.disabled=false;
        btn.textContent="Удалить менеджера";
        alert("Не удалось удалить менеджера: "+(e.message||e));
      }
    });

    const addBlockBtn=document.getElementById("addBlockOption");
    if(addBlockBtn){
      addBlockBtn.onclick=()=>{
        const inp=document.getElementById("newBlockName");
        const name=(inp.value||"").trim();
        if(!name)return;
        db.blockOptions=db.blockOptions||[];
        if(db.blockOptions.includes(name)){ alert("Такой блок уже есть"); return; }
        db.blockOptions.push(name);
        syncRemote(false);
        adminDashboard();
      };
      document.querySelectorAll("[data-remove-block]").forEach(btn=>btn.onclick=()=>{
        const idx=Number(btn.dataset.removeBlock);
        const name=db.blockOptions?.[idx];
        if(!name)return;
        if(!confirm(`Удалить блок «${name}» из списка?`))return;
        db.blockOptions.splice(idx,1);
        syncRemote(false);
        adminDashboard();
      });
    }
  }

  function openManagerConfig(mid){
    const me=db.users.find(u=>u.id===session.userId);
    if(!me || !["admin","viewer"].includes(me.role)) return;
    const canManageBlocks=me.role==="viewer";
    const canManageThesesAndBlocks=me.role==="viewer";
    const manager=db.users.find(u=>u.id===mid);
    if(!manager) return;
    const cfg=managerConfig(mid);
    const modal=document.createElement("div");modal.className="modal";
    modal.innerHTML=`<div class="modal-card">
      <div class="modal-head"><div><h2>Настройки менеджера · ${esc(manager.name)}</h2><div class="muted small">Основные тезисы настраиваются здесь. Создавать и удалять блоки может только наблюдатель.</div></div><button class="icon-btn" data-close>×</button></div>
      <div class="card config-panel admin-message-panel">
        <h3>${me.role==="admin"?"Сообщение от главного админа":"Сообщение от наблюдателя"}</h3>
        <div class="muted small">Сообщение приходит менеджеру как отдельное внутреннее СМС и отмечается непрочитанным.</div>
        <textarea id="bossMsg1" placeholder="Введите сообщение менеджеру...">${esc((me.role==="admin"?cfg.inbox.admin:cfg.inbox.observer).text||"")}</textarea>
        <div class="actions" style="margin-top:10px">
          <button class="btn primary" id="sendBossMessage">Отправить СМС</button>
        </div>
      </div>

      ${canManageThesesAndBlocks?`
      <div class="card config-panel" style="margin-top:14px">
        <h3>Стадии проекта</h3>
        <div class="muted small">Только наблюдатель задаёт стадии один раз для этого менеджера. Они применяются ко всем его проектам.</div>
        <label class="small" style="display:block;margin:12px 0 6px">Стадии проекта (через запятую)</label>
        <input id="managerStagesCsv" value="${esc(cfg.funnelStages.join(", "))}" placeholder="Начальная, Развитие, Слияние, Залив. инф, Пред. предлог, 72 часа">
        <div class="small muted" style="margin-top:6px">Например: Начальная, Развитие, Слияние, Залив. инф, Пред. предлог, 72 часа</div>
      </div>

      <div class="card config-panel" style="margin-top:14px">
        <h3>Название шкалы прогресса</h3>
        <div class="muted small">Задаётся один раз для менеджера и автоматически используется во всех его проектах.</div>
        <input id="progressScaleTitle" value="${esc(cfg.progressScaleTitle||"Шкала прогресса")}" placeholder="Например: Шкала контакта">
      </div>

      <div class="card config-panel" style="margin-top:14px">
        <h3>Основные тезисы менеджера</h3><div class="muted small">Добавляются один раз и автоматически одинаковые во всех проектах этого менеджера.</div>
        <div id="managerThesisTemplates" class="template-list"></div>
        <div class="template-add-row">
          <input id="newThesisTemplate" placeholder="Название тезиса">
          <button class="btn primary" id="addThesisTemplate">+ Добавить</button>
        </div>
      </div>

      <div class="card config-panel" style="margin-top:14px">
        <h3>Основные блоки менеджера</h3><div class="muted small">Добавляются один раз и автоматически одинаковые во всех проектах этого менеджера.</div>
        <div class="muted small">Создавать и удалять блоки может только наблюдатель.</div>
        <div id="managerBlockTemplates" class="template-list"></div>
        <div class="template-add-row">
          <input id="newBlockTemplate" placeholder="Название блока">
          <button class="btn primary" id="addBlockTemplate">+ Добавить блок</button>
        </div>
      </div>`:""}

      <div class="actions">${canManageThesesAndBlocks?'<button class="btn primary" id="saveManagerConfig">Сохранить настройки менеджера</button>':""}<button class="btn ghost" data-close>Закрыть</button></div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll("[data-close]").forEach(x=>x.onclick=()=>modal.remove());

    const renderTpl=()=>{
      const tbox=modal.querySelector("#managerThesisTemplates");
      const bbox=modal.querySelector("#managerBlockTemplates");
      if(!tbox || !bbox) return;
      tbox.innerHTML=cfg.thesisTemplates.length?cfg.thesisTemplates.map(t=>`<div class="template-row"><span>${esc(t.text)}</span><button class="template-del" data-del-thesis="${t.id}">×</button></div>`).join(""):'<div class="muted small">Тезисов пока нет</div>';
      bbox.innerHTML=cfg.blockTemplates.length?cfg.blockTemplates.map(t=>`<div class="template-row"><span>${esc(t.text)}</span>${canManageBlocks?`<button class="template-del" data-del-block="${t.id}">×</button>`:""}</div>`).join(""):'<div class="muted small">Блоков пока нет</div>';
      tbox.querySelectorAll("[data-del-thesis]").forEach(b=>b.onclick=()=>{cfg.thesisTemplates=cfg.thesisTemplates.filter(x=>x.id!==b.dataset.delThesis);renderTpl();});
      if(canManageBlocks) bbox.querySelectorAll("[data-del-block]").forEach(b=>b.onclick=()=>{cfg.blockTemplates=cfg.blockTemplates.filter(x=>x.id!==b.dataset.delBlock);renderTpl();});
    };
    renderTpl();

    const addThesisTemplateBtn=modal.querySelector("#addThesisTemplate");
    if(addThesisTemplateBtn && canManageThesesAndBlocks) addThesisTemplateBtn.onclick=()=>{
      const inp=modal.querySelector("#newThesisTemplate"), text=inp.value.trim();
      if(!text)return;
      cfg.thesisTemplates.push({id:uid("tt_"),stageIndex:0,text});
      inp.value="";renderTpl();
    };
    const addBlockTemplateBtn=modal.querySelector("#addBlockTemplate");
    if(addBlockTemplateBtn && canManageBlocks) addBlockTemplateBtn.onclick=()=>{
      const inp=modal.querySelector("#newBlockTemplate"), text=inp.value.trim();
      if(!text)return;
      cfg.blockTemplates.push({id:uid("bt_"),stageIndex:0,text});
      inp.value="";renderTpl();
    };
    const sendBossMessage=modal.querySelector("#sendBossMessage");
    if(sendBossMessage) sendBossMessage.onclick=async()=>{
      const text=modal.querySelector("#bossMsg1").value.trim();
      if(!text){alert("Введите сообщение");return}
      sendBossMessage.disabled=true;
      sendBossMessage.textContent="Отправляю...";
      try{
        const data=await sendMessageCompat(mid,text);
        if(data.config){
          db.managerConfigs=db.managerConfigs||{};
          db.managerConfigs[mid]=data.config;
          localStorage.setItem(CACHE_KEY,JSON.stringify(db));
        }
        sendBossMessage.textContent="СМС отправлено";
        setTimeout(()=>sendBossMessage.textContent="Отправить СМС",1300);
      }catch(e){
        sendBossMessage.textContent="Ошибка";
        alert("Сообщение не отправилось: "+(e.message||e));
      }finally{
        sendBossMessage.disabled=false;
      }
    };

    const saveManagerConfigBtn=modal.querySelector("#saveManagerConfig");
    if(saveManagerConfigBtn && canManageThesesAndBlocks) saveManagerConfigBtn.onclick=async()=>{
      const titleInput=modal.querySelector("#progressScaleTitle");
      if(titleInput) cfg.progressScaleTitle=titleInput.value.trim()||"Шкала прогресса";

      const stagesInput=modal.querySelector("#managerStagesCsv");
      if(stagesInput){
        const stages=stagesInput.value.split(",").map(x=>x.trim()).filter(Boolean);
        if(stages.length<1){alert("Укажите хотя бы одну стадию");return}
        cfg.funnelStages=stages;
      }

      // Все тезисы и все блоки сохраняются одним массивом на уровне менеджера.
      cfg.thesisTemplates=(cfg.thesisTemplates||[]).map(x=>({
        id:String(x.id||uid("tt_")),
        stageIndex:0,
        text:String(x.text||"").trim()
      })).filter(x=>x.text);
      cfg.blockTemplates=(cfg.blockTemplates||[]).map(x=>({
        id:String(x.id||uid("bt_")),
        stageIndex:0,
        text:String(x.text||"").trim()
      })).filter(x=>x.text);

      syncManagerTemplates(mid);
      (db.clients||[]).filter(p=>p.managerId===mid).forEach(p=>{
        delete p.stages;
        p.stageIndex=Math.min(Number(p.stageIndex)||0,Math.max(0,cfg.funnelStages.length-1));
      });

      saveManagerConfigBtn.disabled=true;
      saveManagerConfigBtn.textContent="Сохраняю...";
      try{
        const ok=await saveManagerSettingsAtomic(mid);
        if(!ok) throw new Error("Сервер не подтвердил сохранение");
        saveManagerConfigBtn.textContent="Сохранено";
        setTimeout(()=>{
          modal.remove();
          adminManagerClients(mid);
        },350);
      }catch(e){
        saveManagerConfigBtn.disabled=false;
        saveManagerConfigBtn.textContent="Сохранить настройки менеджера";
        alert("Настройки менеджера не сохранились: "+(e.message||e));
      }
    };
  }

  function adminManagers(){
    const users=Array.isArray(db?.users)?db.users:[]; const me=users.find(u=>u.id===session.userId)||users.find(u=>u.role==="admin")||users[0];
    const managers=db.users.filter(u=>u.role==="manager");
    shell(`${nav("managers",me)}
      <div class="section-head"><div><h1>Менеджеры</h1><p class="muted">Нажмите на менеджера, чтобы увидеть его проектов</p></div></div>
      <div class="grid">${managers.map(m=>{
        const cc=db.clients.filter(c=>c.managerId===m.id && !c.deleted);
        return `<div class="card manager-card" data-manager="${m.id}" style="cursor:pointer"><div class="manager-profile"><div class="avatar manager-avatar">${m.avatar?`<img src="${m.avatar}" alt="">`:esc((m.name||"М").charAt(0).toUpperCase())}</div><div><div class="manager-name">${esc(m.name)}</div><div class="muted">${cc.length} проектов</div></div></div><button class="btn">Открыть</button></div>`;
      }).join("")||'<div class="empty">Менеджеров нет</div>'}</div>`);
    wireNav();
    document.querySelectorAll("[data-manager]").forEach(el=>el.onclick=()=>adminManagerClients(el.dataset.manager));
  }

  function adminManagerClients(mid){
    const me=db.users.find(u=>u.id===session.userId), m=db.users.find(u=>u.id===mid);
    const clients=db.clients.filter(c=>c.managerId===mid && !c.deleted);
    shell(`${nav("managers",me)}
      <div class="section-head"><div><button class="btn ghost" id="backManagers">← Назад</button><h1 style="margin-top:12px">${esc(m?.name||"Менеджер")}</h1><p class="muted">${clients.length} проектов</p></div><button class="btn primary" id="managerConfigBtn">${me.role==="viewer"?"Настройки менеджера":"Сообщение менеджеру"}</button></div>
      <div class="card manager-notebook-view" style="margin-bottom:14px">
        <div class="manager-notebook-head">
          <div><h3 style="margin:0">Личный блокнот менеджера</h3><div class="muted small">Сохраняется в Цитадели. Виден администратору и наблюдателю.</div></div>
          <div class="notebook-admin-actions"><span class="pill">${esc(m?.name||"")}</span><button class="btn ghost" id="refreshManagerNotebook">Обновить</button></div>
        </div>
        <div class="muted small" id="managerNotebookUpdated">${managerConfig(mid).notebookUpdatedAt?`Обновлён: ${new Date(managerConfig(mid).notebookUpdatedAt).toLocaleString("ru-RU")}`:""}</div>
        <pre class="manager-notebook-content" id="managerNotebookContent">${esc(managerConfig(mid).notebook||"")||"Блокнот пока пуст."}</pre>
      </div>
      <div class="list">${clients.length?clients.map(c=>projectCard(c,me)).join(""):'<div class="empty">Проектов нет</div>'}</div>`);
    wireNav();
    document.getElementById("backManagers").onclick=()=>route("managers");
    document.getElementById("managerConfigBtn").onclick=()=>openManagerConfig(mid);
    document.getElementById("refreshManagerNotebook").onclick=async()=>{
      const btn=document.getElementById("refreshManagerNotebook");
      btn.disabled=true;btn.textContent="Обновляю...";
      try{
        const data=await getManagerDataCompat(mid);
        if(data.config){
          db.managerConfigs=db.managerConfigs||{};
          db.managerConfigs[mid]=data.config;
          localStorage.setItem(CACHE_KEY,JSON.stringify(db));
          document.getElementById("managerNotebookContent").textContent=data.config.notebook||"Блокнот пока пуст.";
          document.getElementById("managerNotebookUpdated").textContent=data.config.notebookUpdatedAt?`Обновлён: ${new Date(data.config.notebookUpdatedAt).toLocaleString("ru-RU")}`:"";
        }
      }catch(e){ alert("Не удалось обновить блокнот"); }
      btn.disabled=false;btn.textContent="Обновить";
    };
    wireProjectCards();
  }

  function adminAllClients(){
    const users=Array.isArray(db?.users)?db.users:[]; const me=users.find(u=>u.id===session.userId)||users.find(u=>u.role==="admin")||users[0];
    shell(`${nav("allclients",me)}
      <div class="section-head"><div><h1>Все проекты</h1><p class="muted">${db.clients.filter(c=>!c.deleted).length} записей</p></div></div>
      <div class="toolbar"><input id="q" placeholder="Поиск"><select id="mgrFilter"><option value="">Все менеджеры</option>${db.users.filter(u=>u.role==="manager").map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join("")}</select></div>
      <div id="clientList" class="list">${db.clients.filter(c=>!c.deleted).map(c=>projectCard(c,me)).join("")||'<div class="empty">Проектов нет</div>'}</div>`);
    wireNav(); wireProjectCards();
    const q=document.getElementById("q"), mf=document.getElementById("mgrFilter");
    const filt=()=>{const t=q.value.toLowerCase().trim(),mid=mf.value;const f=db.clients.filter(c=>!c.deleted&&(!t||c.name.toLowerCase().includes(t)||String(c.number).includes(t))&&(!mid||c.managerId===mid));document.getElementById("clientList").innerHTML=f.map(c=>projectCard(c,me)).join("")||'<div class="empty">Ничего не найдено</div>';wireProjectCards();};
    q.oninput=filt;mf.onchange=filt;
  }


  function trashView(){
    const users=Array.isArray(db?.users)?db.users:[]; const me=users.find(u=>u.id===session.userId)||users.find(u=>u.role==="admin")||users[0];
    const deleted=db.clients.filter(c=>c.deleted && (me.role==="admin"||me.role==="viewer"||c.managerId===me.id));
    shell(`${nav("trash",me)}
      <div class="section-head"><div><h1>Корзина</h1><p class="muted">Удалённые проекты доступны только для просмотра</p></div></div>
      <div class="list">${deleted.length?deleted.map(c=>projectCard(c,me)).join(""):'<div class="empty">Корзина пуста</div>'}</div>`);
    wireNav();
    wireProjectCards();
  }

  function usersView(){
    const users=Array.isArray(db?.users)?db.users:[]; const me=users.find(u=>u.id===session.userId)||users.find(u=>u.role==="admin")||users[0];
    shell(`${nav("users",me)}
      <div class="section-head"><div><h1>Пользователи</h1><p class="muted">Регистрация отключена — аккаунты создаёт администратор. Данные синхронизируются с листом «Пользователи» в Google Таблице.</p></div><button id="addUser" class="btn primary">+ Добавить пользователя</button></div>
      <div class="table-wrap card"><table class="table"><thead><tr><th>Имя</th><th>Логин</th><th>Роль</th><th>Доступ</th><th>ID</th><th></th></tr></thead><tbody>
      ${(db.users||[]).map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.login)}</td><td>${roleName(u.role)}</td><td>${u.active!==false?'<span class="pill green">Разрешён</span>':'<span class="pill gray">Запрещён</span>'}</td><td><span class="small muted">${esc(u.id||"—")}</span></td><td><button class="btn" data-edit-user="${u.id}">Редактировать</button></td></tr>`).join("")}
      </tbody></table></div>`);
    wireNav();
    document.getElementById("addUser").onclick=()=>openUserEditor(null);
    document.querySelectorAll("[data-edit-user]").forEach(b=>b.onclick=()=>openUserEditor(b.dataset.editUser));
  }

  function openUserEditor(id){
    const u=id?db.users.find(x=>x.id===id):null;
    const modal=document.createElement("div");modal.className="modal";
    modal.innerHTML=`<div class="modal-card"><div class="modal-head"><div><h2>${u?"Редактировать":"Новый"} пользователь</h2><div class="muted small">Только администратор может создавать аккаунты</div></div><button class="icon-btn" data-close>×</button></div>
      <form id="userForm" class="form-grid">
        <div class="field"><label>Имя</label><input name="name" required value="${esc(u?.name||"")}"></div>
        <div class="field"><label>Логин</label><input name="login" required value="${esc(u?.login||"")}"></div>
        <div class="field"><label>Пароль</label><input type="password" name="password" ${u?"":"required"} placeholder="${u?"Оставьте пустым, чтобы не менять":"Введите пароль"}"></div>
        <div class="field"><label>Роль</label><select name="role"><option value="manager" ${u?.role==="manager"?"selected":""}>Менеджер</option><option value="viewer" ${u?.role==="viewer"?"selected":""}>Наблюдатель</option><option value="admin" ${u?.role==="admin"?"selected":""}>Администратор</option></select></div>
        <div class="field full">
          <label>Аватар менеджера</label>
          <div class="avatar-editor">
            <div class="avatar avatar-preview" id="avatarPreview">${u?.avatar?`<img src="${u.avatar}" alt="">`:esc((u?.name||"М").charAt(0).toUpperCase())}</div>
            <div class="avatar-controls">
              <input type="file" id="avatarFile" accept="image/*">
              <div class="small muted" style="margin-top:6px">Выбери фотографию менеджера. До 2 МБ.</div>
              ${u?.avatar?'<button type="button" class="btn ghost" id="removeAvatar" style="margin-top:8px">Удалить аватар</button>':""}
            </div>
          </div>
        </div>
        <div class="field"><label>Статус</label><select name="active"><option value="1" ${u?.active!==false?"selected":""}>Активен</option><option value="0" ${u?.active===false?"selected":""}>Заблокирован</option></select></div>
        <div class="actions field full"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn primary">Сохранить</button></div>
      </form></div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll("[data-close]").forEach(x=>x.onclick=()=>modal.remove());
    
    const avatarFile=modal.querySelector("#avatarFile");
    const avatarPreview=modal.querySelector("#avatarPreview");
    modal.dataset.avatarData=u?.avatar||"";
    if(avatarFile){
      avatarFile.onchange=()=>{
        const file=avatarFile.files?.[0];
        if(!file)return;
        if(file.size>2*1024*1024){
          alert("Фотография должна быть не больше 2 МБ");
          avatarFile.value="";
          return;
        }
        const reader=new FileReader();
        reader.onload=()=>{
          modal.dataset.avatarData=String(reader.result);
          if(avatarPreview) avatarPreview.innerHTML=`<img src="${reader.result}" alt="">`;
        };
        reader.readAsDataURL(file);
      };
    }
    const removeAvatar=modal.querySelector("#removeAvatar");
    if(removeAvatar){
      removeAvatar.onclick=()=>{
        modal.dataset.avatarData="";
        if(avatarPreview) avatarPreview.textContent=(u?.name||"М").charAt(0).toUpperCase();
        removeAvatar.remove();
      };
    }
    modal.querySelector("#userForm").onsubmit=e=>{
      e.preventDefault();const fd=new FormData(e.target);
      const cleanName=String(fd.get("name")||"").trim();
      const cleanLogin=String(fd.get("login")||"").trim().toLowerCase();
      const cleanPassword=String(fd.get("password")||"");
      if(!cleanName || !cleanLogin || (!u && !cleanPassword)){alert("Заполните имя, логин и пароль");return}
      if(db.users.some(x=>String(x.login||"").trim().toLowerCase()===cleanLogin&&x.id!==id)){alert("Такой логин уже существует");return}
      const data={id:u?.id||uid("u_"),name:cleanName,login:cleanLogin,password:cleanPassword,role:fd.get("role"),nick:fd.get("nick"),avatar:modal.dataset.avatarData||"",active:fd.get("active")==="1"};
      if(u) Object.assign(u,data); else db.users.push(data);
      syncRemote(false);
      alert(data.password?`Пользователь сохранён.\nЛогин: ${data.login}\nПароль: ${data.password}`:`Пользователь сохранён.\nЛогин: ${data.login}\nПароль не изменён.`);
      modal.remove();route("users");
    };
  }

  function wireProjectCards(){
    document.querySelectorAll("[data-project]").forEach(el=>el.onclick=(e)=>{
      if(e.target.closest("[data-dialog-export]")) return;
      openClient(el.dataset.project);
    });
    document.querySelectorAll("[data-dialog-export]").forEach(btn=>btn.onclick=(e)=>{
      e.stopPropagation();
      openDialogExport(btn.dataset.dialogExport);
    });
  }

  function openDialogExport(id){
    const c=db.clients.find(x=>x.id===id);
    const users=Array.isArray(db?.users)?db.users:[]; const me=users.find(u=>u.id===session.userId)||users.find(u=>u.role==="admin")||users[0];
    if(!c || !me) return;
    if(!["admin","viewer","manager"].includes(me.role)){ alert("Нет доступа"); return; }

    c.dialogExport = c.dialogExport || {updatedAt:"",summary:"",details:""};
    const canEdit = me.role==="viewer" && !c.deleted;
    const modal=document.createElement("div");
    modal.className="modal";
    modal.innerHTML=`<div class="modal-card">
      <div class="modal-head">
        <div>
          <h2>Последняя выгрузка диалога</h2>
          <div class="muted">Проект №${String(c.number).padStart(3,"0")} · ${esc(c.name)}</div>
        </div>
        <button class="icon-btn" data-close>×</button>
      </div>

      ${c.deleted?'<div class="notice">Проект находится в корзине. Выгрузка доступна только для просмотра.</div>':""}

      <div class="card export-date-card">
        <b>Последнее обновление</b>
        <div>${c.dialogExport.updatedAt ? new Date(c.dialogExport.updatedAt).toLocaleString("ru-RU") : "Выгрузка ещё не добавлена"}</div>
      </div>

      <div class="field" style="margin-top:14px">
        <label>Краткая информация о выгрузке</label>
        <textarea id="exportSummary" ${canEdit?"":"readonly"} placeholder="Кратко: что было в последнем диалоге, результат, договорённости">${esc(c.dialogExport.summary||"")}</textarea>
      </div>

      <div class="field" style="margin-top:14px">
        <label>Последняя выгрузка диалога</label>
        <textarea id="exportDetails" ${canEdit?"":"readonly"} class="export-text" placeholder="Вставьте сюда текст или информацию из последней выгрузки диалога">${esc(c.dialogExport.details||"")}</textarea>
      </div>

      <div class="actions">
        ${canEdit?'<button class="btn primary" id="saveDialogExport">Сохранить выгрузку</button>':""}
        <button class="btn ghost" data-close>Закрыть</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll("[data-close]").forEach(x=>x.onclick=()=>modal.remove());
    if(canEdit){
      document.getElementById("saveDialogExport").onclick=()=>{
        c.dialogExport.summary=document.getElementById("exportSummary").value.trim();
        c.dialogExport.details=document.getElementById("exportDetails").value.trim();
        c.dialogExport.updatedAt=nowISO();
        c.history=c.history||[];
        c.history.push({ts:nowISO(),text:"Наблюдатель обновил последнюю выгрузку диалога"});
        syncRemote(false);
        modal.remove(); render();
      };
    }
  }

  function openClient(id){
    const c=db.clients.find(x=>x.id===id), me=db.users.find(u=>u.id===session.userId);
    if(!c)return;
    if(me.role!=="admin" && me.role!=="viewer" && c.managerId!==me.id){alert("Нет доступа");return}
    const manager=db.users.find(u=>u.id===c.managerId);
    const templateChanged=syncProjectTemplates(c);
    if(templateChanged) syncRemote(false);
    const canEdit=!c.deleted && (me.role==="admin"||me.role==="manager");
    const canChecklist=!c.deleted && (me.role==="admin"||me.role==="manager"||me.role==="viewer");
    const canTemplateAdd=!c.deleted && (me.role==="admin"||me.role==="viewer");
    const canDelete=!c.deleted && (me.role==="admin"||me.role==="viewer");
    const canBlockComment=!c.deleted && (me.role==="admin"||me.role==="manager"||me.role==="viewer");
    const modal=document.createElement("div");modal.className="modal";
    modal.innerHTML=`<div class="modal-card"><div class="modal-head"><div><h2>Проект №${String(c.number).padStart(3,"0")} · ${esc(c.name)}</h2><div class="muted">Менеджер: ${esc(manager?.name||"—")} · В общении ${daysBetween(c.startDate)} дн.</div></div><button class="icon-btn" data-close>×</button></div>
      ${pipeline(c)}

      <div class="card theses-card" style="box-shadow:none;border:1px solid var(--line);margin-top:14px">
        <div class="theses-head">
          <div>
            <h3 style="margin:0">Тезисы</h3>
            <div class="muted small">Каждый тезис — отдельная кнопка с галочкой. Отмеченные тезисы суммируются и двигают шкалу прогресса.</div>
          </div>
          <div class="theses-total">${projectTheses(c).filter(t=>t.done!==false).length}/${projectTheses(c).length}</div>
        </div>

        <div id="thesesList" class="theses-list"></div>

      </div>

      <div class="card project-comments-card" style="box-shadow:none;border:1px solid var(--line);margin-top:14px">
        <div class="comments-head"><div><h3 style="margin:0">Комментарии</h3><div class="muted small">Обычные и отрицательные комментарии по проекту.</div></div>
        ${!c.deleted?'<button class="btn primary" id="createProjectComment">+ Создать комментарий</button>':""}</div>
        <div id="projectCommentsList" class="project-comments-list"></div>
      </div>

      <div class="grid" style="margin-top:16px">
        <div class="card" style="box-shadow:none;border:1px solid #e5e7eb"><b>Ник</b><div>${esc(c.nick||"—")}</div></div>
        <div class="card" style="box-shadow:none;border:1px solid #e5e7eb"><b>Пол</b><div>${c.gender==="male"?"Твёрдый":c.gender==="female"?"Мягкий":"—"}</div></div>
        <div class="card geo-card" style="box-shadow:none;border:1px solid #e5e7eb"><b>📍 Гео</b><div>${geoLabel(c)}</div></div>
        
      </div>
      
      <div class="card" style="box-shadow:none;border:1px solid var(--line);margin-top:14px">
        <b>Что уже обсуждали</b>
        <div style="white-space:pre-wrap;margin-top:5px">${esc(c.discussion||"—")}</div>
      </div>
      <div class="card" style="box-shadow:none;border:1px solid var(--line);margin-top:12px">
        <b>Заметки менеджера</b>
        <div style="white-space:pre-wrap;margin-top:5px">${esc(c.notes||"—")}</div>
      </div>

      <div class="card checklist-blocks-card" style="box-shadow:none;border:1px solid var(--line);margin-top:14px">
        <div class="theses-head">
          <div><h3 style="margin:0">Блоки</h3><div class="muted small">Каждый отмеченный блок вместе с тезисами участвует в общем проценте шкалы.</div></div>
          <div class="theses-total">${projectBlocks(c).filter(t=>t.done!==false).length}/${projectBlocks(c).length}</div>
        </div>
        <div id="blockChecklist" class="theses-list"></div>
      </div>

      <h3>История</h3><div class="timeline">${(c.history||[]).slice().sort((a,b)=>b.ts.localeCompare(a.ts)).map(h=>`<div class="timeline-item"><b>${new Date(h.ts).toLocaleString("ru-RU")}</b><span>${esc(h.text)}</span></div>`).join("")||'<div class="muted">Истории пока нет</div>'}</div>
      <div class="actions">${c.deleted?'<span class="pill gray">Проект в корзине — редактирование недоступно</span>':""}${["admin","manager"].includes(me.role)?'<button class="btn ghost" id="viewDialogExport">Последняя выгрузка</button>':""}${me.role==="viewer"&&!c.deleted?'<button class="btn ghost" id="editDialogExport">Добавить / обновить выгрузку</button>':""}${canDelete?'<button class="btn danger" id="deleteProject">Удалить проект</button>':""}${canEdit?'<button class="btn primary" id="editClient">Редактировать</button>':""}<button class="btn ghost" data-close>Закрыть</button></div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll("[data-close]").forEach(x=>x.onclick=()=>modal.remove());
    {
      const editBtn=document.getElementById("editClient");
      if(editBtn) editBtn.onclick=()=>{modal.remove();openClientEditor(id)};
      const delBtn=document.getElementById("deleteProject");
      if(delBtn && canDelete) delBtn.onclick=()=>{
        if(!confirm("Переместить проект в корзину? После этого его нельзя будет редактировать.")) return;
        c.deleted=true;c.deletedAt=nowISO();c.history=c.history||[];c.history.push({ts:nowISO(),text:"Проект перемещён в корзину"});
        syncRemote(false);modal.remove();render();
      };
    }

    c.theses = Array.isArray(c.theses) ? c.theses : [];
    const thesesList=document.getElementById("thesesList");

    const renderTheses=()=>{
      if(!thesesList) return;
      const rows=projectTheses(c);
      if(!rows.length){
        thesesList.innerHTML='<div class="muted">Основные тезисы ещё не добавлены наблюдателем или администратором.</div>';
        return;
      }
      const stats=globalThesisStats(c);
      const itemPct=checklistItemPercent(c);
      thesesList.innerHTML=`<div class="thesis-stage-group">
        <div class="thesis-stage-title"><span>Основные тезисы</span><span class="thesis-counter">${stats.done}/${stats.total} проговорено</span></div>
        <div class="thesis-stage-body">
          ${rows.map(t=>`<label class="check-button ${t.done!==false?"checked":""}">
            <input type="checkbox" data-thesis-toggle="${t.id}" ${t.done!==false?"checked":""} ${canChecklist?"":"disabled"}>
            <span class="check-mark">${t.done!==false?"✓":""}</span>
            <span class="check-text">${esc(t.text)}</span>
            <span class="check-percent">+${itemPct.toFixed(1)}%</span>
          </label>`).join("")}
        </div>
      </div>`;
      if(canChecklist){
        thesesList.querySelectorAll("[data-thesis-toggle]").forEach(el=>el.onchange=async()=>{
          const t=c.theses.find(x=>x.id===el.dataset.thesisToggle);
          if(!t)return;
          const checked=el.checked;
          t.done=checked;t.updatedAt=nowISO();
          c.history=c.history||[];
          c.history.push({ts:nowISO(),text:`Тезис ${checked?"отмечен как проговорённый":"снят"}: «${t.text}»`});

          // Сразу обновляем интерфейс. Каждый выбранный тезис сохраняется отдельно на сервере.
          renderTheses();renderBlockChecklist();
          const p=modal.querySelector(".progress-percent");if(p)p.textContent=`${projectProgress(c)}%`;
          const totalBox=modal.querySelector(".theses-card .theses-total");
          if(totalBox) totalBox.textContent=`${globalThesisStats(c).done}/${globalThesisStats(c).total}`;

          try{
            await saveChecklistAtomic(c.id,"thesis",t.id,checked);
          }catch(e){
            console.error(e);
            alert("Не удалось сохранить выбранный тезис. Повторите.");
          }
        });
      }
    };

    renderTheses();


    c.blockChecks=Array.isArray(c.blockChecks)?c.blockChecks:[];
    const blockChecklist=modal.querySelector("#blockChecklist");
    const renderBlockChecklist=()=>{
      if(!blockChecklist)return;
      const rows=projectBlocks(c);
      const stats=globalBlockStats(c);
      const itemPct=checklistItemPercent(c);
      blockChecklist.innerHTML=rows.length?`<div class="thesis-stage-group">
        <div class="thesis-stage-title"><span>Основные блоки</span><span class="thesis-counter">${stats.done}/${stats.total} отмечено</span></div>
        <div class="thesis-stage-body">
          ${rows.map(b=>`<label class="check-button ${b.done!==false?"checked":""}">
            <input type="checkbox" data-block-toggle="${b.id}" ${b.done!==false?"checked":""} ${canChecklist?"":"disabled"}>
            <span class="check-mark">${b.done!==false?"✓":""}</span>
            <span class="check-text">${esc(b.text)}</span>
            <span class="check-percent">+${itemPct.toFixed(1)}%</span>
          </label>`).join("")}
        </div>
      </div>`:'<div class="muted">Основные блоки ещё не добавлены наблюдателем или администратором.</div>';
      if(canChecklist){
        blockChecklist.querySelectorAll("[data-block-toggle]").forEach(el=>el.onchange=async()=>{
          const b=c.blockChecks.find(x=>x.id===el.dataset.blockToggle);if(!b)return;
          const checked=el.checked;
          b.done=checked;b.updatedAt=nowISO();
          c.history=c.history||[];c.history.push({ts:nowISO(),text:`Блок ${checked?"отмечен":"снят"}: «${b.text}»`});

          renderBlockChecklist();renderTheses();
          const p=modal.querySelector(".progress-percent");if(p)p.textContent=`${projectProgress(c)}%`;
          const totalBox=modal.querySelector(".checklist-blocks-card .theses-total");
          if(totalBox) totalBox.textContent=`${globalBlockStats(c).done}/${globalBlockStats(c).total}`;

          try{
            await saveChecklistAtomic(c.id,"block",b.id,checked);
          }catch(e){
            console.error(e);
            alert("Не удалось сохранить выбранный блок. Повторите.");
          }
        });
      }
    };
    renderBlockChecklist();

    c.projectComments=Array.isArray(c.projectComments)?c.projectComments:[];
    const commentsList=modal.querySelector("#projectCommentsList");
    const renderProjectComments=()=>{
      if(!commentsList)return;
      const rows=c.projectComments.slice().sort((a,b)=>String(b.ts).localeCompare(String(a.ts)));
      commentsList.innerHTML=rows.length?rows.map(x=>`<div class="project-comment ${x.type==="negative"?"negative":""}">
        <div class="project-comment-top"><div><b>${x.type==="negative"?"Отрицательный комментарий":"Комментарий"}</b><span class="muted small"> · ${esc(x.authorName||"")} · ${new Date(x.ts).toLocaleString("ru-RU")}</span></div>
        ${!c.deleted?`<button class="btn ghost small-btn" data-edit-project-comment="${x.id}">Редактировать</button>`:""}</div>
        <div class="project-comment-text">${esc(x.text)}</div>
      </div>`).join(""):'<div class="muted">Комментариев пока нет.</div>';
      commentsList.querySelectorAll("[data-edit-project-comment]").forEach(btn=>btn.onclick=()=>openProjectCommentEditor(btn.dataset.editProjectComment));
    };

    const openProjectCommentEditor=(commentId=null)=>{
      const existing=commentId?c.projectComments.find(x=>x.id===commentId):null;
      const cm=document.createElement("div");cm.className="modal nested-modal";
      cm.innerHTML=`<div class="modal-card small-modal"><div class="modal-head"><h2>${existing?"Редактировать":"Создать"} комментарий</h2><button class="icon-btn" data-close>×</button></div>
        <div class="field"><label>Тип</label><select id="projectCommentType"><option value="normal" ${existing?.type!=="negative"?"selected":""}>Обычный комментарий</option><option value="negative" ${existing?.type==="negative"?"selected":""}>Отрицательный комментарий</option></select></div>
        <div class="field" style="margin-top:12px"><label>Текст</label><textarea id="projectCommentText">${esc(existing?.text||"")}</textarea></div>
        <div class="actions"><button class="btn primary" id="saveProjectComment">Сохранить</button><button class="btn ghost" data-close>Отмена</button></div></div>`;
      document.body.appendChild(cm);cm.querySelectorAll("[data-close]").forEach(x=>x.onclick=()=>cm.remove());
      cm.querySelector("#saveProjectComment").onclick=()=>{
        const text=cm.querySelector("#projectCommentText").value.trim();if(!text){alert("Введите комментарий");return}
        const type=cm.querySelector("#projectCommentType").value;
        if(existing){existing.text=text;existing.type=type;existing.updatedAt=nowISO();}
        else c.projectComments.push({id:uid("pc_"),type,text,ts:nowISO(),authorId:me.id,authorName:me.name});
        syncRemote(false);cm.remove();renderProjectComments();
      };
    };
    renderProjectComments();
    const createCommentBtn=modal.querySelector("#createProjectComment");
    if(createCommentBtn)createCommentBtn.onclick=()=>openProjectCommentEditor();

    c.blockRecords = Array.isArray(c.blockRecords) ? c.blockRecords : [];

    const savedBlocksList=document.getElementById("savedBlocksList");
    const multiBlockSelect=document.getElementById("multiBlockSelect");
    const multiReactionSelect=document.getElementById("multiReactionSelect");
    const multiBlockComment=document.getElementById("multiBlockComment");
    const saveMultiBlock=document.getElementById("saveMultiBlock");

    const renderSavedBlocks=()=>{
      if(!savedBlocksList) return;
      if(!c.blockRecords.length){
        savedBlocksList.innerHTML='<div class="muted">Сохранённых блоков пока нет.</div>';
        return;
      }
      savedBlocksList.innerHTML=c.blockRecords.map((rec,idx)=>{
        const comments=(rec.comments||[]).slice().sort((a,b)=>b.ts.localeCompare(a.ts));
        return `<div class="saved-block-row">
          <div class="saved-block-top">
            <div><b>${esc(rec.block)}</b><span class="reaction-badge">${esc(rec.reaction||"Реакция не указана")}</span></div>
            ${canBlockComment?`<div class="saved-block-actions">
              <button class="btn ghost small-btn" data-edit-saved-block="${idx}">Выбрать</button>
              <button class="btn danger small-btn" data-delete-saved-block="${idx}">Удалить блок</button>
            </div>`:""}
          </div>
          <div class="saved-block-comments">
            ${comments.length?comments.map(x=>`<div class="saved-comment"><div class="saved-comment-meta">${esc(x.authorName||"Пользователь")} · ${new Date(x.ts).toLocaleString("ru-RU")}</div><div>${esc(x.text)}</div></div>`).join(""):'<div class="muted small">Комментариев по этому блоку нет.</div>'}
          </div>
        </div>`;
      }).join("");

      document.querySelectorAll("[data-edit-saved-block]").forEach(btn=>btn.onclick=()=>{
        const rec=c.blockRecords[Number(btn.dataset.editSavedBlock)];
        if(!rec || !multiBlockSelect || !multiReactionSelect) return;
        multiBlockSelect.value=rec.block;
        multiReactionSelect.value=rec.reaction||"";
        if(multiBlockComment) multiBlockComment.value="";
      });

      document.querySelectorAll("[data-delete-saved-block]").forEach(btn=>btn.onclick=()=>{
        const idx=Number(btn.dataset.deleteSavedBlock);
        const rec=c.blockRecords[idx];
        if(!rec) return;
        if(!confirm(`Удалить «${rec.block}» вместе с реакцией и всеми комментариями этого блока?`)) return;

        c.blockRecords.splice(idx,1);

        c.history=c.history||[];
        c.history.push({
          ts:nowISO(),
          text:`Удалён «${rec.block}» вместе с реакцией и комментариями`
        });

        syncRemote(false);

        if(multiBlockSelect && multiBlockSelect.value===rec.block){
          multiBlockSelect.value="";
          multiReactionSelect.value="";
          if(multiBlockComment) multiBlockComment.value="";
        }

        renderSavedBlocks();
      });
    };

    if(saveMultiBlock){
      saveMultiBlock.onclick=()=>{
        const block=(multiBlockSelect?.value||"").trim();
        const reaction=(multiReactionSelect?.value||"").trim();
        const comment=(multiBlockComment?.value||"").trim();

        if(!block){ alert("Выберите блок"); return; }
        if(!reaction){ alert("Выберите реакцию на блок"); return; }

        let rec=c.blockRecords.find(x=>x.block===block);
        if(!rec){
          rec={block,reaction,comments:[]};
          c.blockRecords.push(rec);
        }else{
          rec.reaction=reaction;
          rec.comments=Array.isArray(rec.comments)?rec.comments:[];
        }

        if(comment){
          rec.comments.push({
            ts:nowISO(),
            text:comment,
            authorId:me.id,
            authorName:me.name
          });
        }

        c.history=c.history||[];
        c.history.push({
          ts:nowISO(),
          text:`Сохранён «${block}»: реакция — ${reaction}${comment?" + комментарий":""}`
        });

        syncRemote(false);
        if(multiBlockComment) multiBlockComment.value="";
        renderSavedBlocks();
      };
    }

    renderSavedBlocks();

    const viewExportBtn=document.getElementById("viewDialogExport");
    if(viewExportBtn) viewExportBtn.onclick=()=>{modal.remove();openDialogExport(id);};
    const editExportBtn=document.getElementById("editDialogExport");
    if(editExportBtn) editExportBtn.onclick=()=>{modal.remove();openDialogExport(id);};

  }

  function openClientEditor(id){
    if(id){ const existing=db.clients.find(x=>x.id===id); if(existing?.deleted){alert("Удалённые проекты нельзя редактировать");return;} }
    const me=db.users.find(u=>u.id===session.userId), c=id?db.clients.find(x=>x.id===id):null;
    const modal=document.createElement("div");modal.className="modal";
    modal.innerHTML=`<div class="modal-card"><div class="modal-head"><div><h2>${c?"Редактировать проект":"Новый проект"}</h2><div class="muted small">Все поля можно изменить позже</div></div><button class="icon-btn" data-close>×</button></div>
      <form id="clientForm" class="form-grid">
        <div class="field"><label>Имя</label><input name="name" required value="${esc(c?.name||"")}"></div>
        <div class="field"><label>Ник</label><input name="nick" value="${esc(c?.nick||"")}" placeholder="Введите ник"></div>
        <div class="field"><label>Возраст</label><input name="age" value="${esc(c?.age||"")}"></div><div class="field"><label>Пол</label><select name="gender">
          <option value="">Не указан</option>
          <option value="male" ${c?.gender==="male"?"selected":""}>Твёрдый</option>
          <option value="female" ${c?.gender==="female"?"selected":""}>Мягкий</option>
        </select></div>
        <div class="field"><label>📍 Гео</label><select name="geoType">
          <option value="">Не указано</option>
          <option value="russia" ${c?.geoType==="russia"?"selected":""}>Россия — Классика</option>
          <option value="belarus" ${c?.geoType==="belarus"?"selected":""}>Беларусь — Усы</option>
          <option value="europe" ${c?.geoType==="europe"?"selected":""}>Европа — Радуга</option>
          <option value="other" ${c?.geoType==="other"?"selected":""}>Другое — Иное</option>
        </select></div>
        <div class="field"><label>Регион / уточнение гео</label><input name="region" value="${esc(c?.region||"")}" placeholder="Например: Краснодарский край"></div>
        <div class="field"><label>Дата начала общения</label><input type="date" name="startDate" required value="${esc(c?.startDate||new Date().toISOString().slice(0,10))}"></div>
        <div class="field"><label>Профессия</label><input name="profession" value="${esc(c?.profession||"")}"></div>
        <div class="field full"><label>Интересы</label><input name="interests" value="${esc(c?.interests||"")}"></div>
        <div class="field full"><label>Что уже обсуждали</label>
          <textarea name="discussion" placeholder="Например: познакомились, обсудили цели">${esc(c?.discussion||"")}</textarea>
        </div>
        <div class="field full"><label>Заметки менеджера</label>
          <textarea name="notes" placeholder="Например: перезвонить после выходных">${esc(c?.notes||"")}</textarea>
        </div>
        ${me.role==="admin"?`<div class="field full"><label>Менеджер</label><select name="managerId">${db.users.filter(u=>u.role==="manager").map(u=>`<option value="${u.id}" ${(c?.managerId||"")===u.id?"selected":""}>${esc(u.name)}</option>`).join("")}</select></div>`:""}
        <div class="actions field full"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn primary">Сохранить</button></div>
      </form></div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll("[data-close]").forEach(x=>x.onclick=()=>modal.remove());
    modal.querySelector("#clientForm").onsubmit=e=>{
      e.preventDefault();const fd=new FormData(e.target);
      if(c){
        Object.assign(c,{name:fd.get("name"),nick:fd.get("nick"),age:fd.get("age"),gender:fd.get("gender"),geoType:fd.get("geoType"),region:fd.get("region"),startDate:fd.get("startDate"),profession:fd.get("profession"),discussion:fd.get("discussion"),notes:fd.get("notes"),interests:fd.get("interests"),managerId:me.role==="admin"?fd.get("managerId"):c.managerId});
        const managerStages=managerConfig(c.managerId).funnelStages;
        c.stageIndex=Math.min(Number(c.stageIndex)||0,Math.max(0,managerStages.length-1));
        delete c.stages;
        c.blockRecords=Array.isArray(c.blockRecords)?c.blockRecords:[];c.theses=Array.isArray(c.theses)?c.theses:[];c.history=c.history||[];c.history.push({ts:nowISO(),text:"Карточка проекта отредактирована"});
      }else{
        const nextNum=Math.max(0,...db.clients.map(x=>x.number||0))+1;
        db.clients.push({id:uid("c_"),number:nextNum,name:fd.get("name"),nick:fd.get("nick"),age:fd.get("age"),gender:fd.get("gender"),geoType:fd.get("geoType"),region:fd.get("region"),managerId:me.role==="admin"?fd.get("managerId"):me.id,profession:fd.get("profession"),discussion:fd.get("discussion"),notes:fd.get("notes"),interests:fd.get("interests"),startDate:fd.get("startDate"),stageIndex:0,deleted:false,blockRecords:[],blockChecks:[],theses:[],projectComments:[],history:[{ts:nowISO(),text:"Создан проект"}]});
      }
      syncRemote(false);modal.remove();render();
    };
  }

  let currentRoute=null;
  function route(r){
    currentRoute=r;
    const users=Array.isArray(db?.users)?db.users:[]; const me=users.find(u=>u.id===session.userId)||users.find(u=>u.role==="admin")||users[0];
    if(!me)return loginView();
    if(r==="trash") return trashView();
    if(me.role==="manager" && r==="notebook") return notebookView();
    if(me.role==="admin" || me.role==="viewer"){
      if(r==="managers")return adminManagers();
      if(r==="allclients")return adminAllClients();
      if(r==="users" && me.role==="admin")return usersView();
      return adminDashboard();
    }
    return managerView();
  }
  function render(){
    if(!session)return loginView();
    const users=Array.isArray(db?.users)?db.users:[]; const me=users.find(u=>u.id===session.userId)||users.find(u=>u.role==="admin")||users[0];
    if(!me||!me.active){logout();return}
    route(currentRoute || ((me.role==="admin"||me.role==="viewer")?"dashboard":"clients"));
  }
  async function bootstrap(){
    if(session?.token){
      const ok=await fetchState();
      if(!ok){
        try{
          const cached=JSON.parse(localStorage.getItem(CACHE_KEY)||"null");
          if(cached) db=cached;
        }catch(e){}
      }
    }
    render();
  }
  bootstrap();
})();