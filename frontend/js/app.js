/* Sudsy shared client: Supabase session, API calls, formatting, tracker, item builder, notifications. */
(function () {
  const STATUSES = [
    { key: "received", label: "Received" },
    { key: "washing", label: "Washing" },
    { key: "drying", label: "Drying" },
    { key: "ready", label: "Ready for pickup" },
    { key: "completed", label: "Completed" },
  ];
  const AVATARS = [
    "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=96&h=96&q=70",
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=96&h=96&q=70",
    "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=96&h=96&q=70",
    "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=96&h=96&q=70",
  ];
  const FALLBACK_IMG =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' width='600' height='400'><rect width='600' height='400' fill='#e8f4f3'/><circle cx='300' cy='200' r='60' fill='none' stroke='#7dd6d1' stroke-width='10'/></svg>"
    );

  const Sudsy = { sb: null, profile: null, STATUSES };

  /* ---------- helpers ---------- */
  Sudsy.esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  Sudsy.money = (n) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(n || 0));
  Sudsy.date = (v, withTime) => {
    if (!v) return "Not set";
    const opts = withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" };
    return new Intl.DateTimeFormat("en-PH", opts).format(new Date(v));
  };
  Sudsy.shortId = (id) => String(id).slice(0, 8).toUpperCase();
  Sudsy.statusLabel = (key) => (STATUSES.find((s) => s.key === key) || { label: key }).label;
  Sudsy.unitLabel = (type) => (type === "per_kg" ? "kg" : "pc");
  Sudsy.avatarFor = (seed) => {
    let h = 0;
    for (const ch of String(seed || "x")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return AVATARS[h % AVATARS.length];
  };
  Sudsy.imgFallback = (img) => {
    img.onerror = null;
    img.src = FALLBACK_IMG;
  };
  window.__imgFallback = Sudsy.imgFallback;
  Sudsy.imgTag = (src, alt, cls) =>
    `<img class="${cls || ""}" src="${Sudsy.esc(src || FALLBACK_IMG)}" alt="${Sudsy.esc(alt || "")}" loading="lazy" onerror="__imgFallback(this)">`;

  Sudsy.toast = (message, type) => {
    let box = document.getElementById("toasts");
    if (!box) {
      box = document.createElement("div");
      box.id = "toasts";
      box.className = "toasts";
      box.setAttribute("role", "status");
      box.setAttribute("aria-live", "polite");
      document.body.appendChild(box);
    }
    const el = document.createElement("div");
    el.className = "toast " + (type || "");
    el.textContent = message;
    box.appendChild(el);
    setTimeout(() => el.remove(), type === "error" ? 6000 : 3500);
  };

  Sudsy.setBusy = (button, busy, busyText) => {
    if (!button) return;
    if (busy) {
      button.dataset.label = button.textContent;
      button.disabled = true;
      if (busyText) button.textContent = busyText;
    } else {
      button.disabled = false;
      if (button.dataset.label) button.textContent = button.dataset.label;
    }
  };

  /* ---------- Supabase and session ---------- */
  Sudsy.init = async () => {
    const res = await fetch("/api/config");
    const cfg = await res.json();
    if (!res.ok) throw new Error(cfg.error || "Could not load app settings.");
    Sudsy.sb = window.supabase.createClient(cfg.supabase_url, cfg.supabase_anon_key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    return Sudsy.sb;
  };

  Sudsy.getToken = async () => {
    const { data } = await Sudsy.sb.auth.getSession();
    return data.session ? data.session.access_token : null;
  };

  Sudsy.api = async (path, options) => {
    const { method = "GET", body } = options || {};
    const token = await Sudsy.getToken();
    const res = await fetch("/api" + path, {
      method,
      headers: Object.assign(
        { "Content-Type": "application/json" },
        token ? { Authorization: "Bearer " + token } : {}
      ),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let payload = {};
    try { payload = await res.json(); } catch (_) { /* empty body */ }
    if (res.status === 401) {
      await Sudsy.sb.auth.signOut();
      window.location.href = "/login.html?expired=1";
      throw new Error(payload.error || "Session expired.");
    }
    if (!res.ok) throw new Error(payload.error || "Something went wrong. Try again.");
    return payload;
  };

  Sudsy.homeFor = (role) => (role === "admin" || role === "staff" ? "/admin.html" : "/dashboard.html");

  /** Require a signed-in user. Pass allowed roles to restrict the page. */
  Sudsy.requireSession = async (allowedRoles) => {
    await Sudsy.init();
    const { data } = await Sudsy.sb.auth.getSession();
    if (!data.session) {
      window.location.replace("/login.html");
      return new Promise(() => {});
    }
    const { user } = await Sudsy.api("/auth/me");
    Sudsy.profile = user;
    if (allowedRoles && !allowedRoles.includes(user.role)) {
      window.location.replace(Sudsy.homeFor(user.role));
      return new Promise(() => {});
    }
    Sudsy.sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") window.location.replace("/login.html");
    });
    return user;
  };

  Sudsy.logout = async () => {
    await Sudsy.sb.auth.signOut();
    window.location.href = "/login.html";
  };

  Sudsy.fillUserChrome = () => {
    const p = Sudsy.profile;
    const name = document.getElementById("userName");
    const avatar = document.getElementById("userAvatar");
    if (name) name.textContent = p.full_name || p.email;
    if (avatar) {
      avatar.src = Sudsy.avatarFor(p.id);
      avatar.onerror = () => Sudsy.imgFallback(avatar);
    }
    const out = document.getElementById("logoutBtn");
    if (out) out.addEventListener("click", Sudsy.logout);
  };

  /* ---------- tracker ---------- */
  Sudsy.trackerHTML = (status) => {
    const idx = STATUSES.findIndex((s) => s.key === status);
    return (
      `<ol class="tracker" aria-label="Order progress: ${Sudsy.esc(Sudsy.statusLabel(status))}">` +
      STATUSES.map((s, i) => {
        const cls = i < idx ? "done" : i === idx ? (i === STATUSES.length - 1 ? "current done last" : "current") : "";
        return `<li class="${cls}"${i === idx ? ' aria-current="step"' : ""}>${s.label}</li>`;
      }).join("") +
      "</ol>"
    );
  };

  /* ---------- weight / item calculator ---------- */
  Sudsy.createItemBuilder = ({ container, services, onChange }) => {
    const byId = Object.fromEntries(services.map((s) => [s.id, s]));
    const options = services
      .map(
        (s) =>
          `<option value="${s.id}">${Sudsy.esc(s.name)} (${Sudsy.money(s.unit_price)}/${Sudsy.unitLabel(s.pricing_type)})</option>`
      )
      .join("");

    const rows = () => Array.from(container.querySelectorAll(".item-row"));

    function refreshRow(row) {
      const svc = byId[row.querySelector(".svc").value];
      const qty = row.querySelector(".qty");
      const perKg = svc && svc.pricing_type === "per_kg";
      qty.step = perKg ? "0.1" : "1";
      qty.min = perKg ? "0.1" : "1";
      row.querySelector(".unit").textContent = perKg ? "kg" : "pcs";
      const amount = svc ? Number(svc.unit_price) * (parseFloat(qty.value) || 0) : 0;
      row.querySelector(".line-total").textContent = Sudsy.money(amount);
      return amount;
    }

    function recalc() {
      const total = rows().reduce((sum, row) => sum + refreshRow(row), 0);
      if (onChange) onChange(Math.round(total * 100) / 100, api.getItems());
    }

    const api = {
      add(item) {
        const row = document.createElement("div");
        row.className = "item-row";
        row.innerHTML =
          `<select class="svc" aria-label="Service">${options}</select>` +
          `<div class="qty-wrap"><input class="qty" type="number" inputmode="decimal" aria-label="Weight or quantity" value="1"><span class="unit"></span></div>` +
          `<span class="line-total"></span>` +
          `<button type="button" class="icon-btn remove" aria-label="Remove item">&times;</button>`;
        if (item) {
          row.querySelector(".svc").value = item.service_id;
          row.querySelector(".qty").value = item.quantity;
        }
        row.addEventListener("input", recalc);
        row.addEventListener("change", recalc);
        row.querySelector(".remove").addEventListener("click", () => {
          if (rows().length > 1) { row.remove(); recalc(); }
          else Sudsy.toast("An order needs at least one item.");
        });
        container.appendChild(row);
        recalc();
      },
      set(items) {
        container.innerHTML = "";
        (items && items.length ? items : [null]).forEach((i) => api.add(i));
      },
      getItems() {
        return rows().map((row) => ({
          service_id: row.querySelector(".svc").value,
          quantity: parseFloat(row.querySelector(".qty").value),
        }));
      },
    };
    return api;
  };

  /* ---------- notification bell ---------- */
  Sudsy.initNotifications = async () => {
    const bell = document.getElementById("notifBell");
    if (!bell) return;
    const panel = document.getElementById("notifPanel");
    const count = document.getElementById("notifCount");
    const list = document.getElementById("notifList");
    let items = [];

    function render() {
      const unread = items.filter((n) => !n.is_read).length;
      count.hidden = unread === 0;
      count.textContent = unread > 9 ? "9+" : unread;
      list.innerHTML = items.length
        ? items.map((n) => `<div class="notif-item ${n.is_read ? "" : "unread"}">${Sudsy.esc(n.message)}<time>${Sudsy.date(n.created_at, true)}</time></div>`).join("")
        : '<div class="notif-empty">No notifications yet.</div>';
    }
    async function load() {
      items = (await Sudsy.api("/notifications")).notifications;
      render();
    }

    bell.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      bell.setAttribute("aria-expanded", String(!panel.hidden));
    });
    document.addEventListener("click", (e) => {
      if (!panel.hidden && !panel.contains(e.target) && !bell.contains(e.target)) panel.hidden = true;
    });
    document.getElementById("markAllRead").addEventListener("click", async () => {
      await Sudsy.api("/notifications/read", { method: "POST", body: {} });
      items = items.map((n) => ({ ...n, is_read: true }));
      render();
    });

    await load();
    Sudsy.sb
      .channel("notif-" + Sudsy.profile.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "user_id=eq." + Sudsy.profile.id },
        (payload) => {
          items.unshift(payload.new);
          render();
          Sudsy.toast(payload.new.message);
        })
      .subscribe();
  };

  window.Sudsy = Sudsy;
})();


