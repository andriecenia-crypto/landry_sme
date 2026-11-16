/* Customer dashboard: booking calculator, live order tracker, notifications. */
(async function () {
  const $ = (id) => document.getElementById(id);
  let orders = [];
  let filter = "active";
  let builder;
  let services = [];

  function showBookMessage(text, ok) {
    const box = $("bookMessage");
    box.className = ok ? "form-ok" : "form-error";
    box.textContent = text;
    box.hidden = !text;
  }

  function renderOrders() {
    const shown = orders.filter((o) => (filter === "active" ? o.order_status !== "completed" : o.order_status === "completed"));
    const box = $("orders");
    if (!shown.length) {
      box.innerHTML = filter === "active"
        ? '<div class="empty"><strong>No active orders</strong>Book a drop-off and it will show up here with a live tracker.</div>'
        : '<div class="empty"><strong>No past orders yet</strong>Completed orders are kept here.</div>';
      return;
    }
    box.innerHTML = shown.map((o) => {
      const lines = (o.order_items || []).map((it) => {
        const svc = it.services || {};
        return `<li><span>${Sudsy.esc(svc.name || "Service")} &times; ${Number(it.quantity_or_weight)} ${Sudsy.unitLabel(svc.pricing_type)}</span><span>${Sudsy.money(it.subtotal)}</span></li>`;
      }).join("");
      return `<article class="order ${o.order_status === "ready" ? "is-ready" : ""}">
        <div class="order-top">
          <div><div class="order-id">Order #${Sudsy.shortId(o.id)}</div>
            <div class="small muted">${Sudsy.esc((o.branches || {}).name || "")} &middot; placed ${Sudsy.date(o.created_at, true)}</div></div>
          <div class="row"><span class="badge ${o.order_status}">${Sudsy.statusLabel(o.order_status)}</span><span class="badge ${o.payment_status}">${o.payment_status === "paid" ? "Paid" : "Unpaid"}</span></div>
        </div>
        ${Sudsy.trackerHTML(o.order_status)}
        ${o.order_status === "ready" ? '<p class="small" style="margin:1rem 0 0"><strong>Your clothes are ready.</strong> Bring this order number to the counter.</p>' : ""}
        <ul class="order-lines">${lines}</ul>
        <div class="order-total"><span>Total</span><span>${Sudsy.money(o.total_amount)}</span></div>
        <p class="small muted" style="margin:0.5rem 0 0">Pickup: ${Sudsy.date(o.pickup_date)}</p>
      </article>`;
    }).join("");
  }

  async function loadOrders() {
    orders = (await Sudsy.api("/orders")).orders;
    renderOrders();
  }

  function renderMenu() {
    $("menu").innerHTML = services.map((s) => `<article class="service">${Sudsy.imgTag(s.image_url, s.name)}
      <div class="service-body"><h3>${Sudsy.esc(s.name)}</h3><p class="muted small">${Sudsy.esc(s.description || "")}</p>
      <div class="price">${Sudsy.money(s.unit_price)} <small>per ${s.pricing_type === "per_kg" ? "kg" : "piece"}</small></div></div></article>`).join("")
      || '<p class="muted">The shop has not added services yet.</p>';
  }

  async function init() {
    try {
      await Sudsy.requireSession(["customer"]);
    } catch (err) {
      return Sudsy.toast(err.message, "error");
    }
    Sudsy.fillUserChrome();
    $("greeting").textContent = "Hello, " + ((Sudsy.profile.full_name || "there").split(" ")[0]) + ".";

    try {
      const [svc, br] = await Promise.all([Sudsy.api("/services"), Sudsy.api("/branches")]);
      services = svc.services;
      $("branch").innerHTML = br.branches.map((b) => `<option value="${b.id}">${Sudsy.esc(b.name)}</option>`).join("");
      renderMenu();
      if (services.length) {
        builder = Sudsy.createItemBuilder({
          container: $("items"),
          services,
          onChange: (total) => { $("calcTotal").textContent = Sudsy.money(total); },
        });
        builder.set(null);
      } else {
        showBookMessage("The shop has not added any services yet, so booking is unavailable.");
      }
      const min = new Date();
      min.setDate(min.getDate());
      $("pickup").min = min.toISOString().slice(0, 10);
      await loadOrders();
    } catch (err) {
      Sudsy.toast(err.message, "error");
    }

    $("addItem").addEventListener("click", () => builder && builder.add());

    $("bookingForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      showBookMessage("");
      const btn = e.target.querySelector("button[type=submit]");
      const items = builder ? builder.getItems() : [];
      if (!items.length || items.some((i) => !(i.quantity > 0))) return showBookMessage("Enter a weight or quantity greater than zero for each item.");
      if (!$("branch").value) return showBookMessage("Choose a drop-off branch.");
      Sudsy.setBusy(btn, true, "Placing order...");
      try {
        await Sudsy.api("/orders", {
          method: "POST",
          body: { branch_id: $("branch").value, pickup_date: $("pickup").value || null, items },
        });
        Sudsy.toast("Order placed. Bring your laundry to the branch.", "success");
        builder.set(null);
        $("pickup").value = "";
        filter = "active";
        document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.filter === "active")));
        await loadOrders();
      } catch (err) {
        showBookMessage(err.message);
      } finally {
        Sudsy.setBusy(btn, false);
      }
    });

    document.querySelectorAll(".tab").forEach((tab) =>
      tab.addEventListener("click", () => {
        filter = tab.dataset.filter;
        document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
        renderOrders();
      })
    );

    /* profile dialog */
    const dialog = $("profileDialog");
    $("profileBtn").addEventListener("click", () => {
      $("pName").value = Sudsy.profile.full_name || "";
      $("pPhone").value = Sudsy.profile.phone || "";
      $("pEmail").value = Sudsy.profile.email;
      dialog.showModal();
    });
    $("profileCancel").addEventListener("click", () => dialog.close());
    $("profileForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const { user } = await Sudsy.api("/auth/profile", { method: "PATCH", body: { full_name: $("pName").value, phone: $("pPhone").value } });
        Sudsy.profile = user;
        $("userName").textContent = user.full_name;
        $("greeting").textContent = "Hello, " + user.full_name.split(" ")[0] + ".";
        Sudsy.toast("Profile saved.", "success");
        dialog.close();
      } catch (err) {
        Sudsy.toast(err.message, "error");
      }
    });

    /* realtime: any change to my orders refreshes the tracker */
    Sudsy.sb
      .channel("orders-" + Sudsy.profile.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: "customer_id=eq." + Sudsy.profile.id }, () => { clearTimeout(window.__t); window.__t = setTimeout(() => loadOrders().catch(() => {}), 700); })
      .subscribe();

    Sudsy.initNotifications().catch(() => {});
  }

  init();
})();


