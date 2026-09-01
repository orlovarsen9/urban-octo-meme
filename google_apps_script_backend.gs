/**
 * PROJECT CRM - Google Apps Script backend
 *
 * ВАЖНО:
 * 1. Откройте Google Таблицу -> Расширения -> Apps Script.
 * 2. Полностью замените старый код этим файлом.
 * 3. Deploy -> Manage deployments -> Edit -> New version -> Deploy.
 * 4. Execute as: Me. Access: Anyone.
 *
 * После этого GitHub Pages frontend сможет работать с общей базой на всех устройствах.
 */

const DATA_SHEET = "CRM_DATA";
const PROJECTS_SHEET = "Проекты";
const BLOCKS_SHEET = "Блоки";
const COMMENTS_SHEET = "Комментарии";
const USERS_SHEET = "Пользователи";
const THESES_SHEET = "Тезисы";
const PROJECT_COMMENTS_SHEET = "Комментарии проекта";
const MANAGER_DATA_SHEET = "Блокноты и сообщения";
const CHUNK_SIZE = 40000;
const SESSION_HOURS = 168; // 7 дней

function doGet() {
  try {
    const state = loadState();
    mirrorSheets(state);
    return jsonOut({
      ok:true,
      service:"Цитадель",
      initialized:true,
      users:(state.users || []).length,
      clients:(state.clients || []).length,
      message:"Цитадель инициализирована. Листы созданы/обновлены.",
      time:new Date().toISOString()
    });
  } catch (err) {
    return jsonOut({
      ok:false,
      error:String(err && err.message || err),
      hint:"Откройте Apps Script именно через Расширения → Apps Script в нужной Google Таблице."
    });
  }
}

// Можно запустить вручную из редактора Apps Script один раз.
// Функция сразу создаст CRM_DATA, Пользователи, Проекты, Блоки и Комментарии.
function setupCRM() {
  const state = loadState();
  mirrorSheets(state);
  SpreadsheetApp.flush();
  return "CRM готова. Пользователей: " + (state.users || []).length;
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const action = String(body.action || "");

    if (action === "login") return handleLogin(body);
    if (action === "getState") return handleGetState(body);
    if (action === "getManagerData") return handleGetManagerData(body);
    if (action === "saveNotebook") return handleSaveNotebook(body);
    if (action === "sendMessage") return handleSendMessage(body);
    if (action === "markMessageRead") return handleMarkMessageRead(body);
    if (action === "saveManagerSettings") return handleSaveManagerSettings(body);
    if (action === "saveChecklistItem") return handleSaveChecklistItem(body);
    if (action === "saveState") return handleSaveState(body);
    if (action === "logout") return handleLogout(body);

    return jsonOut({ok:false,error:"Неизвестное действие"});
  } catch (err) {
    return jsonOut({ok:false,error:String(err && err.message || err)});
  }
}

function defaultState() {
  return {
    users: [
      {
        id:"u_admin",
        name:"Главный администратор",
        login:"admin",
        passwordHash:hashPassword("admin123"),
        role:"admin",
        nick:"",
        avatar:"",
        active:true
      },
      {
        id:"u_mgr1",
        name:"Александр",
        login:"manager1",
        passwordHash:hashPassword("manager123"),
        role:"manager",
        nick:"",
        avatar:"",
        active:true
      },
      {
        id:"u_view",
        name:"Наблюдатель",
        login:"viewer",
        passwordHash:hashPassword("viewer123"),
        role:"viewer",
        nick:"",
        avatar:"",
        active:true
      }
    ],
    defaultStages:["Начальная","Развитие","Слияние","Залив. инф","Пред. предлог","72 часа"],
    blockOptions:["Блок 1","Блок 2","Блок 3","Блок 4","Блок 5"],
    managerConfigs:{
      "u_mgr1":{notebook:"",notebookUpdatedAt:"",inbox:{admin:{id:"",text:"",sentAt:"",readAt:""},observer:{id:"",text:"",sentAt:"",readAt:""}},progressScaleTitle:"Шкала прогресса",funnelStages:["Начальная","Развитие","Слияние","Залив. инф","Пред. предлог","72 часа"],thesisTemplates:[],blockTemplates:[]}
    },
    clients:[],
    audit:[]
  };
}

function handleLogin(body) {
  const state = loadState();
  const login = String(body.login || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!state || !Array.isArray(state.users)) {
    return jsonOut({ok:false,error:"Лист CRM_DATA повреждён или база пользователей не создана"});
  }

  const user = (state.users || []).find(function(u){
    return String(u.login || "").trim().toLowerCase() === login && u.active !== false;
  });

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return jsonOut({ok:false,error:"Неверный логин или пароль."});
  }

  const token = Utilities.getUuid() + Utilities.getUuid();
  saveSession(token, user.id);

  return jsonOut({
    ok:true,
    token:token,
    user:sanitizeUser(user),
    state:sanitizeState(state)
  });
}

function handleGetState(body) {
  const state = loadState();
  const user = requireUser(body.token, state);
  if (!user) return jsonOut({ok:false,error:"Сессия истекла. Войдите снова."});
  return jsonOut({ok:true,state:sanitizeState(state)});
}


function emptyManagerConfig() {
  return {
    notebook:"",
    notebookUpdatedAt:"",
    inbox:{
      admin:{id:"",text:"",sentAt:"",readAt:""},
      observer:{id:"",text:"",sentAt:"",readAt:""}
    },
    progressScaleTitle:"Шкала прогресса",
    thesisTemplates:[],
    blockTemplates:[]
  };
}

function normalizeManagerConfig(cfg) {
  cfg = cfg && typeof cfg === "object" ? cfg : emptyManagerConfig();
  cfg.notebook = String(cfg.notebook || "");
  cfg.notebookUpdatedAt = String(cfg.notebookUpdatedAt || "");
  cfg.progressScaleTitle = String(cfg.progressScaleTitle || "Шкала прогресса");
  cfg.funnelStages = Array.isArray(cfg.funnelStages) && cfg.funnelStages.length
    ? cfg.funnelStages.map(function(x){return String(x||"").trim();}).filter(function(x){return !!x;})
    : ["Начальная","Развитие","Слияние","Залив. инф","Пред. предлог","72 часа"];
  cfg.thesisTemplates = Array.isArray(cfg.thesisTemplates) ? cfg.thesisTemplates : [];
  cfg.blockTemplates = Array.isArray(cfg.blockTemplates) ? cfg.blockTemplates : [];
  cfg.inbox = cfg.inbox && typeof cfg.inbox === "object" ? cfg.inbox : {};
  ["admin","observer"].forEach(function(kind){
    var m = cfg.inbox[kind] && typeof cfg.inbox[kind] === "object" ? cfg.inbox[kind] : {};
    cfg.inbox[kind] = {
      id:String(m.id || ""),
      text:String(m.text || ""),
      sentAt:String(m.sentAt || ""),
      readAt:String(m.readAt || "")
    };
  });
  return cfg;
}

function ensureManagerConfig(state, managerId) {
  state.managerConfigs = state.managerConfigs && typeof state.managerConfigs === "object" ? state.managerConfigs : {};
  state.managerConfigs[managerId] = normalizeManagerConfig(state.managerConfigs[managerId]);
  return state.managerConfigs[managerId];
}

function isManager(state, managerId) {
  return (state.users || []).some(function(u){return u.id===managerId && u.role==="manager" && u.active!==false;});
}

function handleGetManagerData(body) {
  const state = loadState();
  const user = requireUser(body.token, state);
  if (!user) return jsonOut({ok:false,error:"Сессия истекла. Войдите снова."});

  const managerId = String(body.managerId || user.id);
  if (!isManager(state, managerId)) return jsonOut({ok:false,error:"Менеджер не найден"});
  if (user.role === "manager" && user.id !== managerId) return jsonOut({ok:false,error:"Нет доступа"});

  const cfg = ensureManagerConfig(state, managerId);
  return jsonOut({ok:true,config:cfg});
}

function handleSaveNotebook(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const state = loadState();
    const user = requireUser(body.token, state);
    if (!user || user.role !== "manager") return jsonOut({ok:false,error:"Нет доступа"});

    const cfg = ensureManagerConfig(state, user.id);
    cfg.notebook = String(body.text || "");
    cfg.notebookUpdatedAt = new Date().toISOString();

    saveState(state);
    mirrorSheets(state);
    SpreadsheetApp.flush();
    return jsonOut({ok:true,config:cfg});
  } finally {
    lock.releaseLock();
  }
}

function handleSendMessage(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const state = loadState();
    const user = requireUser(body.token, state);
    if (!user || ["admin","viewer"].indexOf(user.role) < 0) return jsonOut({ok:false,error:"Нет доступа"});

    const managerId = String(body.managerId || "");
    if (!isManager(state, managerId)) return jsonOut({ok:false,error:"Менеджер не найден"});

    const text = String(body.text || "").trim();
    if (!text) return jsonOut({ok:false,error:"Пустое сообщение"});

    const cfg = ensureManagerConfig(state, managerId);
    const kind = user.role === "admin" ? "admin" : "observer";
    cfg.inbox[kind] = {
      id:"msg_" + Utilities.getUuid(),
      text:text,
      sentAt:new Date().toISOString(),
      readAt:""
    };

    state.audit = Array.isArray(state.audit) ? state.audit : [];
    state.audit.push({
      ts:new Date().toISOString(),
      userId:user.id,
      text:"Отправлено сообщение менеджеру " + managerId + " (" + kind + ")"
    });

    saveState(state);
    mirrorSheets(state);
    SpreadsheetApp.flush();
    return jsonOut({ok:true,config:cfg});
  } finally {
    lock.releaseLock();
  }
}

function handleMarkMessageRead(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const state = loadState();
    const user = requireUser(body.token, state);
    if (!user || user.role !== "manager") return jsonOut({ok:false,error:"Нет доступа"});

    const kind = String(body.kind || "");
    if (["admin","observer"].indexOf(kind) < 0) return jsonOut({ok:false,error:"Некорректный канал"});

    const cfg = ensureManagerConfig(state, user.id);
    const msg = cfg.inbox[kind];
    if (String(body.messageId || "") && String(msg.id || "") === String(body.messageId || "")) {
      msg.readAt = new Date().toISOString();
      saveState(state);
      mirrorSheets(state);
      SpreadsheetApp.flush();
    }
    return jsonOut({ok:true,config:cfg});
  } finally {
    lock.releaseLock();
  }
}


function syncManagerTemplatesServer(state, managerId) {
  const cfg = ensureManagerConfig(state, managerId);
  const thesisIds = {};
  const blockIds = {};
  (cfg.thesisTemplates || []).forEach(function(x){ thesisIds[String(x.id)] = true; });
  (cfg.blockTemplates || []).forEach(function(x){ blockIds[String(x.id)] = true; });

  (state.clients || []).filter(function(p){return p.managerId===managerId;}).forEach(function(p){
    p.theses = Array.isArray(p.theses) ? p.theses : [];
    p.blockChecks = Array.isArray(p.blockChecks) ? p.blockChecks : [];

    // Удаляем только шаблонные элементы, которые наблюдатель удалил.
    p.theses = p.theses.filter(function(x){return !x.templateId || thesisIds[String(x.templateId)];});
    p.blockChecks = p.blockChecks.filter(function(x){return !x.templateId || blockIds[String(x.templateId)];});

    // Добавляем ВСЕ тезисы, сохраняя уже отмеченные состояния существующих.
    (cfg.thesisTemplates || []).forEach(function(tpl){
      var row = p.theses.find(function(x){return String(x.templateId||"")===String(tpl.id||"");});
      if(!row){
        p.theses.push({
          id:"th_"+Utilities.getUuid(),
          templateId:String(tpl.id||""),
          stageIndex:0,
          text:String(tpl.text||""),
          done:false,
          createdAt:new Date().toISOString(),
          updatedAt:new Date().toISOString(),
          authorId:"template",
          authorName:"Шаблон"
        });
      }else{
        row.text=String(tpl.text||"");
        row.stageIndex=0;
      }
    });

    // Добавляем ВСЕ блоки, сохраняя уже отмеченные состояния существующих.
    (cfg.blockTemplates || []).forEach(function(tpl){
      var row = p.blockChecks.find(function(x){return String(x.templateId||"")===String(tpl.id||"");});
      if(!row){
        p.blockChecks.push({
          id:"bc_"+Utilities.getUuid(),
          templateId:String(tpl.id||""),
          stageIndex:0,
          text:String(tpl.text||""),
          done:false,
          createdAt:new Date().toISOString(),
          updatedAt:new Date().toISOString()
        });
      }else{
        row.text=String(tpl.text||"");
        row.stageIndex=0;
      }
    });

    if(Object.prototype.hasOwnProperty.call(p,"stages")) delete p.stages;
  });
}

function handleSaveManagerSettings(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const state = loadState();
    const user = requireUser(body.token, state);
    if (!user || user.role !== "viewer") return jsonOut({ok:false,error:"Только наблюдатель может менять настройки менеджера"});

    const managerId = String(body.managerId || "");
    if (!isManager(state, managerId)) return jsonOut({ok:false,error:"Менеджер не найден"});

    const cfg = ensureManagerConfig(state, managerId);

    cfg.progressScaleTitle = String(body.progressScaleTitle || "Шкала прогресса").trim() || "Шкала прогресса";

    const stages = Array.isArray(body.funnelStages)
      ? body.funnelStages.map(function(x){return String(x||"").trim();}).filter(function(x){return !!x;})
      : [];
    if (!stages.length) return jsonOut({ok:false,error:"Укажите хотя бы одну стадию"});
    cfg.funnelStages = stages;

    // Сохраняем весь массив, а не один выбранный элемент.
    cfg.thesisTemplates = Array.isArray(body.thesisTemplates)
      ? body.thesisTemplates.map(function(x){return {
          id:String(x.id || ("tt_"+Utilities.getUuid())),
          stageIndex:0,
          text:String(x.text||"").trim()
        };}).filter(function(x){return !!x.text;})
      : [];

    cfg.blockTemplates = Array.isArray(body.blockTemplates)
      ? body.blockTemplates.map(function(x){return {
          id:String(x.id || ("bt_"+Utilities.getUuid())),
          stageIndex:0,
          text:String(x.text||"").trim()
        };}).filter(function(x){return !!x.text;})
      : [];

    syncManagerTemplatesServer(state, managerId);

    state.audit = Array.isArray(state.audit) ? state.audit : [];
    state.audit.push({
      ts:new Date().toISOString(),
      userId:user.id,
      text:"Сохранены настройки менеджера "+managerId+
           ": стадий "+cfg.funnelStages.length+
           ", тезисов "+cfg.thesisTemplates.length+
           ", блоков "+cfg.blockTemplates.length
    });

    saveState(state);
    mirrorSheets(state);
    SpreadsheetApp.flush();

    return jsonOut({ok:true,config:cfg,state:sanitizeState(state)});
  } finally {
    lock.releaseLock();
  }
}

function handleSaveChecklistItem(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const state = loadState();
    const user = requireUser(body.token, state);
    if (!user) return jsonOut({ok:false,error:"Сессия истекла"});

    const projectId = String(body.projectId || "");
    const project = (state.clients || []).find(function(p){return p.id===projectId;});
    if(!project) return jsonOut({ok:false,error:"Проект не найден"});

    // Менеджер — только свои проекты. Админ/наблюдатель могут отмечать доступные проекты.
    if(user.role==="manager" && project.managerId!==user.id) return jsonOut({ok:false,error:"Нет доступа"});
    if(["manager","admin","viewer"].indexOf(user.role)<0) return jsonOut({ok:false,error:"Нет доступа"});

    syncManagerTemplatesServer(state, project.managerId);

    const type = String(body.type || "");
    const itemId = String(body.itemId || "");
    const done = body.done === true;

    let row = null;
    if(type==="thesis"){
      project.theses = Array.isArray(project.theses) ? project.theses : [];
      row = project.theses.find(function(x){return String(x.id||"")===itemId;});
    }else if(type==="block"){
      project.blockChecks = Array.isArray(project.blockChecks) ? project.blockChecks : [];
      row = project.blockChecks.find(function(x){return String(x.id||"")===itemId;});
    }else{
      return jsonOut({ok:false,error:"Некорректный тип"});
    }

    if(!row) return jsonOut({ok:false,error:"Элемент не найден"});
    row.done = done;
    row.updatedAt = new Date().toISOString();

    saveState(state);
    mirrorSheets(state);
    SpreadsheetApp.flush();

    return jsonOut({ok:true,project:project});
  } finally {
    lock.releaseLock();
  }
}

function handleSaveState(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
  const current = loadState();
  const user = requireUser(body.token, current);
  if (!user) return jsonOut({ok:false,error:"Сессия истекла. Войдите снова."});

  const incoming = body.state || {};
  if (!Array.isArray(incoming.users) || !Array.isArray(incoming.clients)) {
    return jsonOut({ok:false,error:"Некорректные данные"});
  }

  let next = JSON.parse(JSON.stringify(current));

  if (user.role === "admin") {
    next.defaultStages = Array.isArray(incoming.defaultStages) ? incoming.defaultStages : current.defaultStages;
    next.blockOptions = Array.isArray(incoming.blockOptions) ? incoming.blockOptions : current.blockOptions;
    // Главный админ может отправлять только свой канал сообщений.
    next.managerConfigs = JSON.parse(JSON.stringify(current.managerConfigs || {}));
    const incCfgAll = incoming.managerConfigs && typeof incoming.managerConfigs === "object" ? incoming.managerConfigs : {};
    Object.keys(incCfgAll).forEach(function(mid){
      if(!next.managerConfigs[mid]) next.managerConfigs[mid]={notebook:"",notebookUpdatedAt:"",inbox:{admin:{id:"",text:"",sentAt:"",readAt:""},observer:{id:"",text:"",sentAt:"",readAt:""}},progressScaleTitle:"Шкала прогресса",funnelStages:["Начальная","Развитие","Слияние","Залив. инф","Пред. предлог","72 часа"],thesisTemplates:[],blockTemplates:[]};
      const inc=incCfgAll[mid] || {};
      if(!next.managerConfigs[mid].inbox) next.managerConfigs[mid].inbox={admin:{id:"",text:"",sentAt:"",readAt:""},observer:{id:"",text:"",sentAt:"",readAt:""}};
      if(inc.inbox && inc.inbox.admin){
        const curMsg=next.managerConfigs[mid].inbox.admin || {};
        const incMsg=inc.inbox.admin || {};
        const curTs=Date.parse(curMsg.sentAt || "") || 0;
        const incTs=Date.parse(incMsg.sentAt || "") || 0;
        if(incTs >= curTs) next.managerConfigs[mid].inbox.admin=incMsg;
      }
    });
    next.clients = incoming.clients;
    next.audit = Array.isArray(incoming.audit) ? incoming.audit : [];

    const existing = {};
    (current.users || []).forEach(function(u){ existing[u.id] = u; });

    next.users = incoming.users.map(function(u){
      const old = existing[u.id];
      const rawPassword = String(u.password || "");
      return {
        id:u.id || ("u_" + Utilities.getUuid()),
        name:String(u.name || "").trim(),
        login:String(u.login || "").trim().toLowerCase(),
        passwordHash: rawPassword ? hashPassword(rawPassword) : (old ? old.passwordHash : ""),
        role:["admin","manager","viewer"].indexOf(u.role) >= 0 ? u.role : "manager",
        nick:String(u.nick || ""),
        avatar:String(u.avatar || ""),
        active:u.active !== false
      };
    });

    const seen = {};
    for (var i=0;i<next.users.length;i++) {
      const lg = next.users[i].login;
      if (!lg) return jsonOut({ok:false,error:"У пользователя пустой логин"});
      if (seen[lg]) return jsonOut({ok:false,error:"Логин " + lg + " используется дважды"});
      seen[lg] = true;
      if (!next.users[i].passwordHash) return jsonOut({ok:false,error:"Для нового пользователя нужен пароль"});
    }
  } else if (user.role === "manager") {
    // Менеджер меняет только свои проекты и свой блокнот.
    const protectedClients = (current.clients || []).filter(function(c){ return c.managerId !== user.id; });
    const existingOwn = {};
    (current.clients || []).filter(function(c){return c.managerId===user.id;}).forEach(function(c){existingOwn[c.id]=c;});
    const ownIncoming = (incoming.clients || []).filter(function(c){ return c.managerId === user.id; }).map(function(c){
      const old=existingOwn[c.id];
      if(old && old.deleted===true) c.deleted=true;
      if(old && old.deleted!==true && c.deleted===true) c.deleted=false; // менеджер не может удалять
      return c;
    });
    next.clients = protectedClients.concat(ownIncoming);

    next.managerConfigs = JSON.parse(JSON.stringify(current.managerConfigs || {}));
    if(!next.managerConfigs[user.id]) next.managerConfigs[user.id]={notebook:"",notebookUpdatedAt:"",inbox:{admin:{id:"",text:"",sentAt:"",readAt:""},observer:{id:"",text:"",sentAt:"",readAt:""}},progressScaleTitle:"Шкала прогресса",funnelStages:["Начальная","Развитие","Слияние","Залив. инф","Пред. предлог","72 часа"],thesisTemplates:[],blockTemplates:[]};
    const incomingCfg=(incoming.managerConfigs || {})[user.id] || {};
    next.managerConfigs[user.id].notebook=String(incomingCfg.notebook || "");
    next.managerConfigs[user.id].notebookUpdatedAt=String(incomingCfg.notebookUpdatedAt || new Date().toISOString());

    // Менеджер может менять только статус "прочитано", но не текст/дату сообщений.
    if(!next.managerConfigs[user.id].inbox) next.managerConfigs[user.id].inbox={admin:{id:"",text:"",sentAt:"",readAt:""},observer:{id:"",text:"",sentAt:"",readAt:""}};
    ["admin","observer"].forEach(function(kind){
      const curMsg=next.managerConfigs[user.id].inbox[kind] || {id:"",text:"",sentAt:"",readAt:""};
      const incMsg=(incomingCfg.inbox || {})[kind] || {};
      if(String(incMsg.id||"")===String(curMsg.id||"")){
        curMsg.readAt=String(incMsg.readAt||curMsg.readAt||"");
      }
      next.managerConfigs[user.id].inbox[kind]=curMsg;
    });

  } else if (user.role === "viewer") {
    // Наблюдатель: один набор тезисов/блоков и одно название шкалы на менеджера + свой канал сообщений.
    next.clients = incoming.clients;
    next.managerConfigs = JSON.parse(JSON.stringify(current.managerConfigs || {}));
    const incCfgAll = incoming.managerConfigs && typeof incoming.managerConfigs === "object" ? incoming.managerConfigs : {};
    Object.keys(incCfgAll).forEach(function(mid){
      if(!next.managerConfigs[mid]) next.managerConfigs[mid]={notebook:"",notebookUpdatedAt:"",inbox:{admin:{id:"",text:"",sentAt:"",readAt:""},observer:{id:"",text:"",sentAt:"",readAt:""}},progressScaleTitle:"Шкала прогресса",funnelStages:["Начальная","Развитие","Слияние","Залив. инф","Пред. предлог","72 часа"],thesisTemplates:[],blockTemplates:[]};
      const cur=next.managerConfigs[mid];
      const inc=incCfgAll[mid] || {};
      cur.thesisTemplates=Array.isArray(inc.thesisTemplates)?inc.thesisTemplates:(cur.thesisTemplates||[]);
      cur.blockTemplates=Array.isArray(inc.blockTemplates)?inc.blockTemplates:(cur.blockTemplates||[]);
      cur.progressScaleTitle=String(inc.progressScaleTitle||cur.progressScaleTitle||"Шкала прогресса");
      cur.funnelStages=Array.isArray(inc.funnelStages)&&inc.funnelStages.length
        ? inc.funnelStages.map(function(x){return String(x||"").trim();}).filter(function(x){return !!x;})
        : (cur.funnelStages||["Начальная","Развитие","Слияние","Залив. инф","Пред. предлог","72 часа"]);
      if(!cur.inbox) cur.inbox={admin:{id:"",text:"",sentAt:"",readAt:""},observer:{id:"",text:"",sentAt:"",readAt:""}};
      if(inc.inbox && inc.inbox.observer){
        const curMsg=cur.inbox.observer || {};
        const incMsg=inc.inbox.observer || {};
        const curTs=Date.parse(curMsg.sentAt || "") || 0;
        const incTs=Date.parse(incMsg.sentAt || "") || 0;
        if(incTs >= curTs) cur.inbox.observer=incMsg;
      }
    });
    next.audit = Array.isArray(incoming.audit) ? incoming.audit : current.audit;
  } else {
    return jsonOut({ok:false,error:"Нет прав"});
  }

  saveState(next);
  mirrorSheets(next);

  return jsonOut({ok:true,state:sanitizeState(next)});
  } finally {
    lock.releaseLock();
  }
}

function handleLogout(body) {
  if (body.token) {
    PropertiesService.getScriptProperties().deleteProperty("sess_" + body.token);
  }
  return jsonOut({ok:true});
}

function requireUser(token, state) {
  if (!token) return null;
  const raw = PropertiesService.getScriptProperties().getProperty("sess_" + token);
  if (!raw) return null;
  try {
    const sess = JSON.parse(raw);
    if (Date.now() > Number(sess.exp || 0)) {
      PropertiesService.getScriptProperties().deleteProperty("sess_" + token);
      return null;
    }
    return (state.users || []).find(function(u){ return u.id === sess.userId && u.active !== false; }) || null;
  } catch(e) {
    return null;
  }
}

function saveSession(token, userId) {
  const exp = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  PropertiesService.getScriptProperties().setProperty("sess_" + token, JSON.stringify({userId:userId,exp:exp}));
}

function getSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error("Скрипт не привязан к Google Таблице. Откройте нужную таблицу → Расширения → Apps Script и вставьте код туда.");
  }
  return ss;
}

function getDataSheet() {
  const ss = getSpreadsheet();
  let sh = ss.getSheetByName(DATA_SHEET);
  if (!sh) sh = ss.insertSheet(DATA_SHEET);
  return sh;
}

function loadState() {
  const sh = getDataSheet();
  const last = sh.getLastRow();
  if (!last) {
    const state = defaultState();
    saveState(state);
    mirrorSheets(state);
    return state;
  }

  const values = sh.getRange(1,1,last,1).getValues();
  let text = "";
  values.forEach(function(r){ text += String(r[0] || ""); });

  if (!text) {
    const state = defaultState();
    saveState(state);
    mirrorSheets(state);
    return state;
  }

  try {
    return JSON.parse(text);
  } catch(e) {
    throw new Error("Не удалось прочитать общую базу CRM");
  }
}

function saveState(state) {
  const sh = getDataSheet();
  const text = JSON.stringify(state);
  const chunks = [];
  for (let i=0;i<text.length;i+=CHUNK_SIZE) chunks.push([text.slice(i,i+CHUNK_SIZE)]);
  sh.clearContents();
  if (chunks.length) sh.getRange(1,1,chunks.length,1).setValues(chunks);
  sh.hideSheet();
}

function mirrorSheets(state) {
  const ss = getSpreadsheet();

  let projects = ss.getSheetByName(PROJECTS_SHEET);
  if (!projects) projects = ss.insertSheet(PROJECTS_SHEET);
  let blocks = ss.getSheetByName(BLOCKS_SHEET);
  if (!blocks) blocks = ss.insertSheet(BLOCKS_SHEET);
  let comments = ss.getSheetByName(COMMENTS_SHEET);
  if (!comments) comments = ss.insertSheet(COMMENTS_SHEET);
  let usersSheet = ss.getSheetByName(USERS_SHEET);
  if (!usersSheet) usersSheet = ss.insertSheet(USERS_SHEET);
  let thesesSheet = ss.getSheetByName(THESES_SHEET);
  if (!thesesSheet) thesesSheet = ss.insertSheet(THESES_SHEET);
  let projectCommentsSheet = ss.getSheetByName(PROJECT_COMMENTS_SHEET);
  if (!projectCommentsSheet) projectCommentsSheet = ss.insertSheet(PROJECT_COMMENTS_SHEET);
  let managerDataSheet = ss.getSheetByName(MANAGER_DATA_SHEET);
  if (!managerDataSheet) managerDataSheet = ss.insertSheet(MANAGER_DATA_SHEET);

  projects.clearContents();
  blocks.clearContents();
  comments.clearContents();
  usersSheet.clearContents();
  thesesSheet.clearContents();
  projectCommentsSheet.clearContents();
  managerDataSheet.clearContents();

  const pRows = [[
    "№","Имя","Ник","Пол","Профессия","Менеджер","Дата начала",
    "Стадия","Прогресс %","Гео","Регион","Удалён","Что уже обсуждали","Заметки менеджера","Тезисов","Проговорено тезисов","Блоков","Отмечено блоков"
  ]];
  const bRows = [["№ проекта","Имя","Блок","Реакция"]];
  const cRows = [["№ проекта","Имя","Блок","Автор","Дата","Комментарий"]];
  const uRows = [["ID","Имя","Логин","Роль","Доступ","Ник"]];
  const tRows = [["№ проекта","Имя","Этап","Тезис","Проговорен","Автор","Создан"]];
  const pcRows = [["№ проекта","Имя","Тип","Автор","Дата","Комментарий"]];
  const mdRows = [["Менеджер","Логин","Название шкалы","Стадии воронки","Кол-во тезисов","Кол-во блоков","Блокнот","Блокнот обновлён","Сообщение главного админа","Дата","Прочитано","Сообщение наблюдателя","Дата","Прочитано"]];

  (state.users || []).forEach(function(u){
    uRows.push([
      u.id || "",
      u.name || "",
      u.login || "",
      u.role || "",
      u.active !== false ? "Разрешён" : "Запрещён",
      u.nick || ""
    ]);
  });

  const users = {};
  (state.users || []).forEach(function(u){ users[u.id] = u; });

  function calcProgress(p){
    const rows=(p.theses || []).concat(p.blockChecks || []);
    if(!rows.length) return 0;
    const done=rows.filter(function(t){return t.done!==false;}).length;
    return Math.round((done/rows.length)*1000)/10;
  }

  (state.users || []).filter(function(u){return u.role==="manager";}).forEach(function(u){
    const cfg=((state.managerConfigs||{})[u.id]) || {};
    const inbox=cfg.inbox || {};
    const a=inbox.admin || {};
    const o=inbox.observer || {};
    mdRows.push([
      u.name || "",
      u.login || "",
      cfg.progressScaleTitle || "Шкала прогресса",
      (cfg.funnelStages || ["Начальная","Развитие","Слияние","Залив. инф","Пред. предлог","72 часа"]).join(" → "),
      (cfg.thesisTemplates || []).length,
      (cfg.blockTemplates || []).length,
      cfg.notebook || "",
      cfg.notebookUpdatedAt || "",
      a.text || "",
      a.sentAt || "",
      a.readAt ? "Да" : "Нет",
      o.text || "",
      o.sentAt || "",
      o.readAt ? "Да" : "Нет"
    ]);
  });

  (state.clients || []).forEach(function(p){
    const manager = users[p.managerId];
    const allTheses=p.theses || [];
    const doneTheses=allTheses.filter(function(t){return t.done!==false;}).length;
    const allBlocks=p.blockChecks || [];
    const doneBlocks=allBlocks.filter(function(t){return t.done!==false;}).length;
    pRows.push([
      p.number || "",
      p.name || "",
      p.nick || "",
      p.gender || "",
      p.profession || "",
      manager ? manager.name : "",
      p.startDate || "",
      (p.stages || [])[p.stageIndex] || "",
      calcProgress(p),
      p.geoType || "",
      p.region || "",
      p.deleted ? "Да" : "Нет",
      p.discussion || "",
      p.notes || "",
      allTheses.length,
      doneTheses,
      allBlocks.length,
      doneBlocks
    ]);

    allTheses.forEach(function(t){
      tRows.push([
        p.number || "",
        p.name || "",
        "Основные",
        t.text || "",
        t.done !== false ? "Да" : "Нет",
        t.authorName || "",
        t.createdAt || ""
      ]);
    });
    (p.projectComments || []).forEach(function(pc){
      pcRows.push([
        p.number || "",
        p.name || "",
        pc.type === "negative" ? "Отрицательный" : "Обычный",
        pc.authorName || "",
        pc.ts || "",
        pc.text || ""
      ]);
    });

    (p.blockRecords || []).forEach(function(b){
      bRows.push([p.number || "",p.name || "",b.block || "",b.reaction || ""]);
      (b.comments || []).forEach(function(c){
        cRows.push([
          p.number || "",
          p.name || "",
          b.block || "",
          c.authorName || "",
          c.ts || "",
          c.text || ""
        ]);
      });
    });
  });

  projects.getRange(1,1,pRows.length,pRows[0].length).setValues(pRows);
  blocks.getRange(1,1,bRows.length,bRows[0].length).setValues(bRows);
  comments.getRange(1,1,cRows.length,cRows[0].length).setValues(cRows);
  usersSheet.getRange(1,1,uRows.length,uRows[0].length).setValues(uRows);
  thesesSheet.getRange(1,1,tRows.length,tRows[0].length).setValues(tRows);
  projectCommentsSheet.getRange(1,1,pcRows.length,pcRows[0].length).setValues(pcRows);
  managerDataSheet.getRange(1,1,mdRows.length,mdRows[0].length).setValues(mdRows);
  projects.setFrozenRows(1);
  blocks.setFrozenRows(1);
  comments.setFrozenRows(1);
  usersSheet.setFrozenRows(1);
  thesesSheet.setFrozenRows(1);
  projectCommentsSheet.setFrozenRows(1);
  managerDataSheet.setFrozenRows(1);
}

function sanitizeState(state) {
  const out = JSON.parse(JSON.stringify(state));
  out.users = (out.users || []).map(sanitizeUser);
  return out;
}

function sanitizeUser(u) {
  const out = JSON.parse(JSON.stringify(u));
  delete out.passwordHash;
  out.password = "";
  return out;
}

function hashPassword(password) {
  const salt = Utilities.getUuid().replace(/-/g,"");
  return salt + ":" + digest(salt + ":" + String(password));
}

function verifyPassword(password, stored) {
  if (!stored || stored.indexOf(":") < 0) return false;
  const pos = stored.indexOf(":");
  const salt = stored.slice(0,pos);
  const expected = stored.slice(pos+1);
  return digest(salt + ":" + String(password)) === expected;
}

function digest(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function(b){
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? "0" + v : v;
  }).join("");
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
