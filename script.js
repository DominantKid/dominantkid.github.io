const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const hasFirebaseConfig = Object.values(firebaseConfig).every(
  value => !String(value).includes("YOUR_")
);
const LOCAL_COMPANIES_EVENT = "tno_companies_updated";
const HEIST_COOLDOWN_MS = 60_000;
const DAILY_COOLDOWN_MS = 12 * 60 * 60 * 1000;

const storage = {
  readCompanies() {
    return JSON.parse(localStorage.getItem("tno_companies") || "{}");
  },
  writeCompanies(companies) {
    localStorage.setItem("tno_companies", JSON.stringify(companies));
    window.dispatchEvent(new CustomEvent(LOCAL_COMPANIES_EVENT));
  },
  subscribeCompanies(listener) {
    const notify = () => listener(this.readCompanies());
    const storageHandler = event => {
      if (event.key === "tno_companies") notify();
    };

    window.addEventListener("storage", storageHandler);
    window.addEventListener(LOCAL_COMPANIES_EVENT, notify);
    notify();

    return () => {
      window.removeEventListener("storage", storageHandler);
      window.removeEventListener(LOCAL_COMPANIES_EVENT, notify);
    };
  },
  setCompany(owner, payload) {
    const companies = this.readCompanies();
    companies[owner] = payload;
    this.writeCompanies(companies);
    return Promise.resolve();
  },
  getCompany(owner, listener) {
    listener(this.readCompanies()[owner] || null);
    return this.subscribeCompanies(companies => listener(companies[owner] || null));
  },
  updateCompany(owner, updater) {
    const companies = this.readCompanies();
    const current = companies[owner];
    if (!current) return Promise.resolve(false);
    companies[owner] = updater(current);
    this.writeCompanies(companies);
    return Promise.resolve(true);
  }
};

let db = null;
if (hasFirebaseConfig && window.firebase) {
  firebase.initializeApp(firebaseConfig);
  db = firebase.database();
}

let currentUser = null;
let currentCompany = null;
let companiesSnapshot = {};
let companiesUnsubscribe = null;
let companyUnsubscribe = null;

window.addEventListener("load", () => {
  bindEvents();

  const savedUser = localStorage.getItem("tno_user");
  const savedPass = localStorage.getItem("tno_pass");
  if (savedUser && savedPass) {
    currentUser = savedUser;
    showHome();
  }

  if (!hasFirebaseConfig) {
    notify("Firebase keys are placeholders. Running in local-browser mode.", "err");
  }
});

function bindEvents() {
  document.getElementById("loginBtn").addEventListener("click", loginOrRegister);
  document.getElementById("enterCompanyBtn").addEventListener("click", enterGame);
  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("createCompanyBtn").addEventListener("click", createCompany);
  document.getElementById("dailyBonusBtn").addEventListener("click", claimDailyBonus);
  document.getElementById("collectIncomeBtn").addEventListener("click", collectIncome);
  document.getElementById("hireGuardBtn").addEventListener("click", hireGuard);
  document.getElementById("trainOperativeBtn").addEventListener("click", trainOperative);
  document.getElementById("runMissionBtn").addEventListener("click", runMission);
  document.getElementById("upgradeSecurityBtn").addEventListener("click", upgradeSecurity);
  document.getElementById("coolDownHeatBtn").addEventListener("click", layLow);
  document.getElementById("goHomeBtn").addEventListener("click", showHome);
}

function notify(msg, type = "ok") {
  const banner = document.getElementById("statusBanner");
  banner.textContent = msg;
  banner.className = `status-banner ${type}`;
}

function loginOrRegister() {
  const name = document.getElementById("usernameInput").value.trim();
  const password = document.getElementById("passwordInput").value;

  if (!name || !password) {
    notify("Enter both username and password.", "err");
    return;
  }

  const storedPass = localStorage.getItem(`tno_pass_${name}`);
  if (storedPass && storedPass !== password) {
    notify("Incorrect password.", "err");
    return;
  }
  if (!storedPass) localStorage.setItem(`tno_pass_${name}`, password);

  currentUser = name;
  localStorage.setItem("tno_user", name);
  localStorage.setItem("tno_pass", password);
  notify(`Welcome, ${name}.`, "ok");
  showHome();
}

function logout() {
  stopGameSubscriptions();
  localStorage.removeItem("tno_user");
  localStorage.removeItem("tno_pass");
  currentUser = null;
  currentCompany = null;
  hideAll();
  document.getElementById("loginDiv").style.display = "block";
  notify("Logged out.", "ok");
}

function showHome() {
  stopGameSubscriptions();
  hideAll();
  document.getElementById("homeDiv").style.display = "block";
  document.getElementById("userName").textContent = currentUser || "";
}

function enterGame() {
  hideAll();
  document.getElementById("gameDiv").style.display = "block";
  startGameSubscriptions();
}

function hideAll() {
  document.getElementById("loginDiv").style.display = "none";
  document.getElementById("homeDiv").style.display = "none";
  document.getElementById("gameDiv").style.display = "none";
}

function stopGameSubscriptions() {
  if (typeof companiesUnsubscribe === "function") companiesUnsubscribe();
  if (typeof companyUnsubscribe === "function") companyUnsubscribe();
  companiesUnsubscribe = null;
  companyUnsubscribe = null;
}

function startGameSubscriptions() {
  stopGameSubscriptions();
  companiesUnsubscribe = subscribeCompanies(companies => {
    companiesSnapshot = normalizeCompanies(companies);
    renderCompanies(companiesSnapshot);
    renderLeaderboard(companiesSnapshot);
  });

  companyUnsubscribe = getCompany(currentUser, company => {
    currentCompany = normalizeCompany(company, currentUser);
    document.getElementById("companyName").value = currentCompany?.name || "";
    document.getElementById("companyPassword").value = "";
    updateStats();
    renderLog();
  });
}

function createCompany() {
  const name = document.getElementById("companyName").value.trim();
  const password = document.getElementById("companyPassword").value;
  if (!name || !password) {
    notify("Enter company name and password.", "err");
    return;
  }

  const payload = normalizeCompany({
    ...currentCompany,
    owner: currentUser,
    name,
    password
  }, currentUser);

  setCompany(currentUser, payload).then(() => {
    currentCompany = payload;
    pushLog("🏢 Company profile updated.");
    notify("Company saved.", "ok");
  });
}

function claimDailyBonus() {
  if (!requireCompany()) return;
  const now = Date.now();
  const remaining = (currentCompany.lastDailyAt + DAILY_COOLDOWN_MS) - now;
  if (remaining > 0) {
    const mins = Math.ceil(remaining / 60000);
    notify(`Daily bonus ready in ${mins} min.`, "err");
    return;
  }

  mutateMyCompany(company => {
    company.money += 150;
    company.intel += 1;
    company.lastDailyAt = now;
    grantXp(company, 15);
    appendLog(company, "🎁 Claimed daily bonus: +$150 and +1 intel.");
    return company;
  });
  notify("Daily bonus claimed!", "ok");
}

function collectIncome() {
  if (!requireCompany()) return;

  mutateMyCompany(company => {
    const income = 20 + (company.level * 5);
    company.money += income;
    company.heat += 1;
    grantXp(company, 5);
    appendLog(company, `💵 Collected income +$${income}.`);
    return company;
  });
  notify("Income collected.", "ok");
}

function hireGuard() {
  if (!requireCompany()) return;
  if (currentCompany.money < 50) return notify("Not enough money for a guard.", "err");

  mutateMyCompany(company => {
    company.money -= 50;
    company.guards += 1;
    company.security += 1;
    grantXp(company, 8);
    appendLog(company, "🛡️ Hired 1 guard.");
    return company;
  });
  notify("Guard hired.", "ok");
}

function trainOperative() {
  if (!requireCompany()) return;
  if (currentCompany.money < 80) return notify("Not enough money to train operative.", "err");

  mutateMyCompany(company => {
    company.money -= 80;
    company.operatives += 1;
    grantXp(company, 10);
    appendLog(company, "🕶️ Trained 1 operative.");
    return company;
  });
  notify("Operative trained.", "ok");
}

function runMission() {
  if (!requireCompany()) return;
  if (currentCompany.operatives < 1) return notify("Need at least 1 operative to run a mission.", "err");

  mutateMyCompany(company => {
    const successRate = Math.min(0.9, 0.55 + (company.level * 0.03) - (company.heat * 0.004));
    const success = Math.random() < successRate;

    if (success) {
      const reward = 40 + Math.floor(Math.random() * 120);
      const intel = Math.random() < 0.6 ? 1 : 0;
      company.money += reward;
      company.intel += intel;
      company.heat += 4;
      grantXp(company, 18);
      appendLog(company, `✅ Mission success: +$${reward}${intel ? " and +1 intel" : ""}.`);
    } else {
      const fine = 20 + Math.floor(Math.random() * 35);
      company.money = Math.max(0, company.money - fine);
      company.heat += 8;
      grantXp(company, 6);
      appendLog(company, `❌ Mission failed: -$${fine}, heat increased.`);
    }

    return company;
  });
  notify("Mission completed.", "ok");
}

function upgradeSecurity() {
  if (!requireCompany()) return;
  if (currentCompany.money < 120) return notify("Not enough money to upgrade security.", "err");

  mutateMyCompany(company => {
    company.money -= 120;
    company.security += 2;
    grantXp(company, 12);
    appendLog(company, "🏰 Security upgraded (+2)." );
    return company;
  });
  notify("Security upgraded.", "ok");
}

function layLow() {
  if (!requireCompany()) return;
  if (currentCompany.money < 30) return notify("Need $30 to lay low.", "err");

  mutateMyCompany(company => {
    company.money -= 30;
    company.heat = Math.max(0, company.heat - 10);
    appendLog(company, "🧊 Laid low and reduced heat.");
    return company;
  });
  notify("Heat reduced.", "ok");
}

function attemptHeist(targetOwner) {
  if (!requireCompany()) return;
  if (targetOwner === currentUser) return notify("You cannot attack your own company.", "err");
  if (currentCompany.operatives < 1) return notify("Need at least 1 operative for a heist.", "err");

  const now = Date.now();
  if (currentCompany.nextHeistAt > now) {
    const secs = Math.ceil((currentCompany.nextHeistAt - now) / 1000);
    return notify(`Heist cooldown active: ${secs}s`, "err");
  }

  const target = companiesSnapshot[targetOwner];
  if (!target) return notify("Target company unavailable.", "err");

  const attackerPower = currentCompany.operatives * 2 + currentCompany.guards + (currentCompany.intel * 2) + (Math.random() * 5);
  const defenderPower = target.guards * 2 + target.security + (Math.random() * 6);
  const successChance = Math.max(0.15, Math.min(0.9, attackerPower / (attackerPower + defenderPower)));
  const success = Math.random() < successChance;

  mutateMyCompany(company => {
    company.nextHeistAt = Date.now() + HEIST_COOLDOWN_MS;
    company.intel = Math.max(0, company.intel - 1);

    if (success) {
      const stolen = Math.max(30, Math.min(300, Math.floor(target.money * 0.25)));
      company.money += stolen;
      company.heat += 10;
      grantXp(company, 25);
      appendLog(company, `💰 Heist on ${target.name} succeeded: +$${stolen}.`);
      updateCompany(targetOwner, rival => {
        const normalized = normalizeCompany(rival, targetOwner);
        normalized.money = Math.max(0, normalized.money - stolen);
        appendLog(normalized, `🚨 ${currentUser} stole $${stolen} in a heist.`);
        return normalized;
      });
    } else {
      company.heat += 12;
      if (company.operatives > 0) company.operatives -= 1;
      grantXp(company, 8);
      appendLog(company, `🚫 Heist on ${target.name} failed. Lost 1 operative.`);
    }

    return company;
  });

  notify(success ? "Heist successful!" : "Heist failed.", success ? "ok" : "err");
}

function spyOnTarget(targetOwner) {
  if (!requireCompany()) return;
  if (currentCompany.intel < 1) return notify("Need at least 1 intel point to spy.", "err");

  const target = companiesSnapshot[targetOwner];
  if (!target) return notify("Target company unavailable.", "err");

  mutateMyCompany(company => {
    company.intel -= 1;
    appendLog(company, `🛰️ Intel: ${target.name} has $${target.money}, guards ${target.guards}, security ${target.security}.`);
    return company;
  });

  notify(`Intel report gathered on ${target.name}.`, "ok");
}

function renderCompanies(companies) {
  const list = document.getElementById("companyList");
  list.innerHTML = "";
  const rivals = Object.values(companies).filter(company => company.owner !== currentUser);

  if (!rivals.length) {
    list.innerHTML = '<p class="muted">No rivals yet. Invite a friend to battle!</p>';
    return;
  }

  rivals.forEach(company => {
    const div = document.createElement("div");
    div.className = "company";

    div.innerHTML = `
      <div class="company-header">
        <strong>${escapeHtml(company.name)}</strong>
        <span>$${company.money}</span>
      </div>
      <div class="company-meta">Owner: ${escapeHtml(company.owner)} | Guards: ${company.guards} | Security: ${company.security} | Level: ${company.level}</div>
    `;

    const actions = document.createElement("div");
    actions.className = "company-actions";

    const heistBtn = document.createElement("button");
    heistBtn.textContent = "Launch Heist";
    heistBtn.addEventListener("click", () => attemptHeist(company.owner));

    const spyBtn = document.createElement("button");
    spyBtn.textContent = "Spy (1 intel)";
    spyBtn.className = "secondary";
    spyBtn.addEventListener("click", () => spyOnTarget(company.owner));

    actions.appendChild(heistBtn);
    actions.appendChild(spyBtn);
    div.appendChild(actions);
    list.appendChild(div);
  });
}

function renderLeaderboard(companies) {
  const list = document.getElementById("leaderboardList");
  list.innerHTML = "";

  const sorted = Object.values(companies)
    .sort((a, b) => getNetWorth(b) - getNetWorth(a))
    .slice(0, 8);

  if (!sorted.length) {
    list.innerHTML = '<p class="muted">Leaderboard will appear once companies are created.</p>';
    return;
  }

  sorted.forEach((company, index) => {
    const item = document.createElement("div");
    item.className = "company";
    item.innerHTML = `
      <div class="company-header">
        <span><span class="leader-rank">#${index + 1}</span> ${escapeHtml(company.name)}</span>
        <strong>Net Worth: $${getNetWorth(company)}</strong>
      </div>
      <div class="company-meta">Owner: ${escapeHtml(company.owner)} | Lvl ${company.level} | Guards ${company.guards} | Ops ${company.operatives}</div>
    `;
    list.appendChild(item);
  });
}

function renderLog() {
  const logDiv = document.getElementById("activityLog");
  logDiv.innerHTML = "";
  const items = currentCompany?.log || [];

  if (!items.length) {
    logDiv.innerHTML = '<p class="muted">No activity yet. Start building your empire.</p>';
    return;
  }

  items.slice(0, 8).forEach(entry => {
    const row = document.createElement("div");
    row.className = "log-item";
    row.textContent = entry;
    logDiv.appendChild(row);
  });
}

function updateStats() {
  const c = currentCompany || baseCompany(currentUser);
  document.getElementById("yourMoney").textContent = c.money;
  document.getElementById("yourGuards").textContent = c.guards;
  document.getElementById("yourOperatives").textContent = c.operatives;
  document.getElementById("yourIntel").textContent = c.intel;
  document.getElementById("yourHeat").textContent = c.heat;
  document.getElementById("yourLevel").textContent = c.level;
}

function requireCompany() {
  if (!currentCompany) {
    notify("Create your company first.", "err");
    return false;
  }
  return true;
}

function mutateMyCompany(updater) {
  if (!currentUser || !currentCompany) return Promise.resolve();
  const next = normalizeCompany(updater({ ...currentCompany }), currentUser);
  currentCompany = next;
  updateStats();
  renderLog();
  return setCompany(currentUser, next);
}

function pushLog(message) {
  if (!currentCompany) return;
  mutateMyCompany(company => {
    appendLog(company, message);
    return company;
  });
}

function appendLog(company, message) {
  company.log = company.log || [];
  company.log.unshift(`${new Date().toLocaleTimeString()} ${message}`);
  company.log = company.log.slice(0, 20);
}

function grantXp(company, amount) {
  company.xp += amount;
  while (company.xp >= company.level * 40) {
    company.xp -= company.level * 40;
    company.level += 1;
    company.money += 60;
    appendLog(company, `⭐ Leveled up to ${company.level}! Bonus +$60.`);
  }
}

function getNetWorth(company) {
  return company.money + (company.guards * 30) + (company.operatives * 45) + (company.security * 25) + (company.level * 100);
}

function normalizeCompanies(companies) {
  const safe = companies || {};
  Object.keys(safe).forEach(owner => {
    safe[owner] = normalizeCompany(safe[owner], owner);
  });
  return safe;
}

function normalizeCompany(company, owner) {
  if (!company) return null;
  return {
    ...baseCompany(owner),
    ...company,
    owner: company.owner || owner,
    money: Number(company.money ?? 100),
    guards: Number(company.guards ?? 0),
    operatives: Number(company.operatives ?? 0),
    intel: Number(company.intel ?? 0),
    heat: Number(company.heat ?? 0),
    security: Number(company.security ?? 0),
    level: Number(company.level ?? 1),
    xp: Number(company.xp ?? 0),
    nextHeistAt: Number(company.nextHeistAt ?? 0),
    lastDailyAt: Number(company.lastDailyAt ?? 0),
    log: Array.isArray(company.log) ? company.log : []
  };
}

function baseCompany(owner) {
  return {
    owner,
    name: "",
    password: "",
    money: 100,
    guards: 0,
    operatives: 0,
    intel: 0,
    heat: 0,
    security: 0,
    level: 1,
    xp: 0,
    nextHeistAt: 0,
    lastDailyAt: 0,
    log: []
  };
}

function setCompany(owner, payload) {
  if (db) return db.ref(`companies/${owner}`).set(payload);
  return storage.setCompany(owner, payload);
}

function updateCompany(owner, updater) {
  if (db) {
    return db.ref(`companies/${owner}`).get().then(snapshot => {
      const existing = snapshot.val();
      if (!existing) return null;
      return db.ref(`companies/${owner}`).set(updater(normalizeCompany(existing, owner)));
    });
  }
  return storage.updateCompany(owner, existing => updater(normalizeCompany(existing, owner)));
}

function subscribeCompanies(listener) {
  if (db) {
    const ref = db.ref("companies");
    const callback = snapshot => listener(snapshot.val() || {});
    ref.on("value", callback);
    return () => ref.off("value", callback);
  }
  return storage.subscribeCompanies(listener);
}

function getCompany(owner, listener) {
  if (db) {
    const ref = db.ref(`companies/${owner}`);
    const callback = snapshot => listener(snapshot.val());
    ref.on("value", callback);
    return () => ref.off("value", callback);
  }
  return storage.getCompany(owner, listener);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
