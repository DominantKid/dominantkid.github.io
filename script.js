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

const storage = {
  readCompanies() {
    return JSON.parse(localStorage.getItem("tno_companies") || "{}");
  },
  writeCompanies(companies) {
    localStorage.setItem("tno_companies", JSON.stringify(companies));
    window.dispatchEvent(new CustomEvent(LOCAL_COMPANIES_EVENT));
  },
  subscribeCompanies(listener) {
    const notifyListener = () => listener(this.readCompanies());

    const storageHandler = event => {
      if (event.key === "tno_companies") notifyListener();
    };

    window.addEventListener("storage", storageHandler);
    window.addEventListener(LOCAL_COMPANIES_EVENT, notifyListener);
    notifyListener();

    return () => {
      window.removeEventListener("storage", storageHandler);
      window.removeEventListener(LOCAL_COMPANIES_EVENT, notifyListener);
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
    const unsubscribe = this.subscribeCompanies(companies => {
      listener(companies[owner] || null);
    });
    return unsubscribe;
  },
  updateCompany(owner, updater) {
    const companies = this.readCompanies();
    const company = companies[owner];
    if (!company) return Promise.resolve(false);
    companies[owner] = updater(company);
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
  document.getElementById("collectIncomeBtn").addEventListener("click", collectIncome);
  document.getElementById("hireGuardBtn").addEventListener("click", hireGuard);
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

  if (!storedPass) {
    localStorage.setItem(`tno_pass_${name}`, password);
  }

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
  companiesUnsubscribe = subscribeCompanies(renderCompanies);
  companyUnsubscribe = getCompany(currentUser, company => {
    currentCompany = company;
    document.getElementById("companyName").value = company?.name || "";
    document.getElementById("companyPassword").value = "";
    updateStats();
  });
}

function createCompany() {
  const name = document.getElementById("companyName").value.trim();
  const password = document.getElementById("companyPassword").value;

  if (!name || !password) {
    notify("Enter company name and password.", "err");
    return;
  }

  const payload = {
    owner: currentUser,
    name,
    money: currentCompany?.money ?? 100,
    guards: currentCompany?.guards ?? 0,
    password
  };

  setCompany(currentUser, payload).then(() => {
    currentCompany = payload;
    updateStats();
    notify("Company saved.", "ok");
  });
}

function collectIncome() {
  if (!currentCompany) {
    notify("Create your company first.", "err");
    return;
  }

  mutateMyCompany(company => ({ ...company, money: company.money + 20 }));
  notify("Collected income (+$20).", "ok");
}

function hireGuard() {
  if (!currentCompany) {
    notify("Create your company first.", "err");
    return;
  }

  if (currentCompany.money < 50) {
    notify("Not enough money to hire a guard.", "err");
    return;
  }

  mutateMyCompany(company => ({ ...company, money: company.money - 50, guards: company.guards + 1 }));
  notify("Guard hired.", "ok");
}

function attemptSabotage(targetOwner) {
  if (!currentCompany) {
    notify("Create your company first.", "err");
    return;
  }
  if (targetOwner === currentUser) {
    notify("You cannot sabotage your own company.", "err");
    return;
  }
  if (currentCompany.guards < 1) {
    notify("You need at least 1 guard to attempt sabotage.", "err");
    return;
  }

  const target = companiesSnapshot[targetOwner];
  if (!target) {
    notify("Target company not found.", "err");
    return;
  }

  const guess = window.prompt(`Enter password for ${target.name}:`);
  if (guess === null) return;

  if (guess === target.password) {
    const stolen = Math.min(40, Number(target.money) || 0);
    updateCompany(targetOwner, t => ({ ...t, money: Math.max(0, t.money - stolen) }));
    mutateMyCompany(c => ({ ...c, money: c.money + stolen }));
    notify(`Success! You stole $${stolen}.`, "ok");
  } else {
    mutateMyCompany(c => ({ ...c, guards: Math.max(0, c.guards - 1) }));
    notify("Sabotage failed. You lost 1 guard.", "err");
  }
}

function renderCompanies(companies) {
  const list = document.getElementById("companyList");
  list.innerHTML = "";
  companiesSnapshot = companies || {};

  const values = Object.values(companiesSnapshot);
  if (!values.length) {
    list.innerHTML = '<p class="muted">No companies yet.</p>';
    return;
  }

  values.forEach(company => {
    const div = document.createElement("div");
    div.className = "company";

    const isSelf = company.owner === currentUser;
    const money = Number(company.money) || 0;
    const guards = Number(company.guards) || 0;

    div.innerHTML = `
      <div class="company-header">
        <strong>${escapeHtml(company.name)}</strong>
        <span>$${money}</span>
      </div>
      <div class="company-meta">Owner: ${escapeHtml(company.owner)} | Guards: ${guards}</div>
    `;

    if (!isSelf) {
      const btn = document.createElement("button");
      btn.textContent = "Attempt sabotage";
      btn.addEventListener("click", () => attemptSabotage(company.owner));
      div.appendChild(btn);
    }

    list.appendChild(div);
  });
}

function updateStats() {
  document.getElementById("yourMoney").textContent = currentCompany ? currentCompany.money : 0;
  document.getElementById("yourGuards").textContent = currentCompany ? currentCompany.guards : 0;
}

function mutateMyCompany(updater) {
  if (!currentUser || !currentCompany) return;
  const next = updater(currentCompany);
  currentCompany = next;
  updateStats();
  return setCompany(currentUser, next);
}

function setCompany(owner, payload) {
  if (db) return db.ref(`companies/${owner}`).set(payload);
  return storage.setCompany(owner, payload);
}

function updateCompany(owner, updater) {
  if (db) {
    return db.ref(`companies/${owner}`).get().then(snapshot => {
      const existing = snapshot.val();
      if (existing) return db.ref(`companies/${owner}`).set(updater(existing));
      return null;
    });
  }
  return storage.updateCompany(owner, updater);
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
