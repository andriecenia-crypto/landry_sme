/* Shop dashboard for admins and staff: orders, prices, inventory, people, branches. */
(async function () {
  const $ = (id) => document.getElementById(id);
  const S = Sudsy;
  const state = { orders: [], services: [], branches: [], inventory: [], users: [], stats: null };
  let isAdmin = false;
  let orderBuilder = null;
  let editingOrderId = null;
  let editingServiceId = null;
  let editingInventoryId = null;
  let editingBranchId = null;

  /* ---------- small helpers ---------- */
  const fail = (err) => S.toast(err.message || "Something went wrong.", "error");
  const showError = (id, text) => { const el = $(id); el.className = "form-error"; el.textContent = text; el.hidden = !text; };
  const branchName = (id) => (state.branches.find((b) => b.id === id) || {}).name || "";
  const branchOptions = (selected) =>
    state.branches.map((b) => `<option value="${b.id}" ${b.id === selected ? "selected" : ""}>${S.esc(b.name)}</option>`).join("");
  const statusOptions = (selected) =>
    S.STATUSES.map((s) => `<option value="${s.key}" ${s.key === selected ? "selected" : ""}>${s.label}</option>`).join("");
  const emptyRow = (cols, title, text) =>
    `<tr><td colspan="${cols}"><div class="empty"><strong>${title}</strong>${text}</div></td></tr>`;

  /* ---------- tabs ---------- */
  function showTab(name) {
    document.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
    document.querySelectorAll("[role=tabpanel]").forEach((p) => (p.hidden = p.id !== "tab-" + name));
    history.replaceState(null, "", "#" + name);
  }

  /* ---------- loading ---------- */
  async function loadAll() {
    const [orders, services, branches, inventory, users, stats] = await Promise.all([
      S.api("/orders"), S.api("/services"), S.api("/branches"),
      S.api("/inventory"), S.api("/admin/users"), S.api("/admin/stats"),
    ]);
    Object.assign(state, {
      orders: orders.orders, services: services.services, branches: branches.branches,
      inventory: inventory.items, users: users.users, stats,
    });
    renderAll();
  }
  async function refreshOrders() {
    const [orders, stats] = await Promise.all([S.api("/orders"), S.api("/admin/stats")]);
    state.orders = orders.orders; state.stats = stats;
    renderOverview(); renderOrders();
  }
  async function refreshInventory() {
    const [inv, stats] = await Promise.all([S.api("/inventory"), S.api("/admin/stats")]);
    state.inventory = inv.items; state.stats = stats;
    renderOverview(); renderInventory();
  }

  function renderAll() {
    renderOverview(); renderOrders(); renderServices(); renderInventory(); renderPeople(); renderBranches();
  }

  /* ---------- overview ---------- */
  function lowStockList() { return state.inventory.filter((i) => i.is_low); }

  function lowStockAlertHTML() {
    const low = lowStockList();
    if (!low.length) return "";
    return `<div class="alert" role="status"><strong>${low.length} ${low.length === 1 ? "supply is" : "supplies are"} running low</strong>
      <ul>${low.slice(0, 6).map((i) => `<li>${S.esc(i.item_name)} at ${S.esc((i.branches || {}).name || "")}: ${Number(i.stock_quantity)} ${S.esc(i.unit)} left (reorder at ${Number(i.reorder_level)})</li>`).join("")}</ul>
      ${low.length > 6 ? `<p class="small" style="margin:0.4rem 0 0">And ${low.length - 6} more in Inventory.</p>` : ""}</div>`;
  }

  function renderOverview() {
    const st = state.stats;
    $("lowStockAlert").innerHTML = lowStockAlertHTML();
    $("stats").innerHTML = [
      ["Active orders", st.active_orders, ""],
      ["Ready for pickup", st.by_status.ready, st.by_status.ready ? "attention" : ""],
      ["Unpaid orders", st.unpaid_orders, ""],
      ["Paid today", S.money(st.revenue_today), ""],
      ["Paid in total", S.money(st.revenue_total), ""],
      ["Supplies running low", st.low_stock_count, st.low_stock_count ? "attention" : ""],
    ].map(([label, value, cls]) => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div></div>`).join("");

    const recent = state.orders.slice(0, 6);
    $("recentOrders").innerHTML = recent.length
      ? `<div class="table-wrap"><table><tbody>${recent.map((o) => `<tr>
          <td><strong>#${S.shortId(o.id)}</strong></td><td>${S.esc((o.customer || {}).full_name || "Customer")}</td>
          <td><span class="badge ${o.order_status}">${S.statusLabel(o.order_status)}</span></td>
          <td class="right">${S.money(o.total_amount)}</td></tr>`).join("")}</tbody></table></div>`
      : '<div class="empty"><strong>No orders yet</strong>Select New order to log your first drop-off.</div>';
  }

  /* ---------- orders ---------- */
  function renderOrders() {
    const q = $("orderSearch").value.trim().toLowerCase();
    const status = $("orderStatusFilter").value;
    const pay = $("orderPaymentFilter").value;
    const rows = state.orders.filter((o) => {
      if (status && o.order_status !== status) return false;
      if (pay && o.payment_status !== pay) return false;
      if (!q) return true;
      const c = o.customer || {};
      return [S.shortId(o.id), c.full_name, c.email].some((v) => String(v || "").toLowerCase().includes(q));
    });
    $("ordersBody").innerHTML = rows.length
      ? rows.map((o) => {
          const c = o.customer || {};
          const items = (o.order_items || []).map((i) => `${S.esc((i.services || {}).name || "Service")} &times; ${Number(i.quantity_or_weight)}`).join("<br>");
          return `<tr data-id="${o.id}">
            <td><strong>#${S.shortId(o.id)}</strong><div class="small muted">${S.date(o.created_at)}</div></td>
            <td>${S.esc(c.full_name || "Customer")}<div class="small muted">${S.esc(c.email || "")}</div></td>
            <td>${S.esc((o.branches || {}).name || "")}</td>
            <td class="small">${items}</td>
            <td>${S.money(o.total_amount)}</td>
            <td><select class="status-select" aria-label="Order status for #${S.shortId(o.id)}">${statusOptions(o.order_status)}</select></td>
            <td><button class="btn sm ${o.payment_status === "paid" ? "ghost" : "lemon"} pay-toggle" type="button" title="Toggle payment">${o.payment_status === "paid" ? "Paid" : "Mark paid"}</button></td>
            <td>${S.date(o.pickup_date)}</td>
            <td><div class="actions"><button class="btn ghost sm edit-order" type="button">Edit</button><button class="btn danger sm delete-order" type="button">Delete</button></div></td></tr>`;
        }).join("")
      : emptyRow(9, "No orders match", "Try a different search or filter.");
  }

  $("ordersBody").addEventListener("change", async (e) => {
    if (!e.target.classList.contains("status-select")) return;
    const id = e.target.closest("tr").dataset.id;
    try {
      await S.api("/orders/" + id, { method: "PATCH", body: { order_status: e.target.value } });
      S.toast("Status updated. The customer has been notified.", "success");
      await refreshOrders();
    } catch (err) { fail(err); await refreshOrders(); }
  });

  $("ordersBody").addEventListener("click", async (e) => {
    const row = e.target.closest("tr[data-id]");
    if (!row) return;
    const order = state.orders.find((o) => o.id === row.dataset.id);
    if (e.target.closest(".pay-toggle")) {
      try {
        await S.api("/orders/" + order.id, { method: "PATCH", body: { payment_status: order.payment_status === "paid" ? "unpaid" : "paid" } });
        S.toast("Payment updated.", "success");
        await refreshOrders();
      } catch (err) { fail(err); }
    } else if (e.target.closest(".edit-order")) {
      openOrderDialog(order);
    } else if (e.target.closest(".delete-order")) {
      if (!confirm(`Delete order #${S.shortId(order.id)}? This removes it for the customer too and cannot be undone.`)) return;
      try {
        await S.api("/orders/" + order.id, { method: "DELETE" });
        S.toast("Order deleted.", "success");
        await refreshOrders();
      } catch (err) { fail(err); }
    }
  });
  ["input", "change"].forEach((ev) => {
    $("orderSearch").addEventListener(ev, renderOrders);
    $("orderStatusFilter").addEventListener(ev, renderOrders);
    $("orderPaymentFilter").addEventListener(ev, renderOrders);
  });

  /* ---------- order dialog ---------- */
  function openOrderDialog(order) {
    editingOrderId = order ? order.id : null;
    $("orderDialogTitle").textContent = order ? `Edit order #${S.shortId(order.id)}` : "New order";
    showError("orderFormError", "");
    $("customerFields").hidden = !!order;
    $("oBranch").innerHTML = branchOptions(order ? order.branch_id : "");
    $("oStatus").innerHTML = statusOptions(order ? order.order_status : "received");
    $("oStatus").disabled = !order; // new orders always start as received
    $("oPayment").value = order ? order.payment_status : "unpaid";
    $("oPickup").value = order && order.pickup_date ? order.pickup_date.slice(0, 10) : "";
    ["oEmail", "oName", "oPhone"].forEach((id) => ($(id).value = ""));
    $("customerList").innerHTML = state.users
      .filter((u) => u.role === "customer")
      .map((u) => `<option value="${S.esc(u.email)}">${S.esc(u.full_name)}</option>`).join("");
    if (!state.services.length) return S.toast("Add a service before creating orders.", "error");
    orderBuilder = S.createItemBuilder({
      container: $("oItems"), services: state.services,
      onChange: (total) => { $("oTotal").textContent = S.money(total); },
    });
    orderBuilder.set(order ? order.order_items.map((i) => ({ service_id: i.service_id, quantity: Number(i.quantity_or_weight) })) : null);
    $("orderDialog").showModal();
  }

  $("oEmail").addEventListener("change", () => {
    const match = state.users.find((u) => u.email.toLowerCase() === $("oEmail").value.trim().toLowerCase());
    if (match) { $("oName").value = match.full_name; $("oPhone").value = match.phone || ""; }
  });
  $("oAddItem").addEventListener("click", () => orderBuilder && orderBuilder.add());
  $("newOrderBtn").addEventListener("click", () => openOrderDialog(null));

  $("orderForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("orderFormError", "");
    const items = orderBuilder.getItems();
    if (items.some((i) => !(i.quantity > 0))) return showError("orderFormError", "Enter a weight or quantity greater than zero for each item.");
    const btn = $("orderSave");
    S.setBusy(btn, true, "Saving...");
    try {
      if (editingOrderId) {
        await S.api("/orders/" + editingOrderId, {
          method: "PATCH",
          body: { branch_id: $("oBranch").value, order_status: $("oStatus").value, payment_status: $("oPayment").value, pickup_date: $("oPickup").value || null, items },
        });
      } else {
        await S.api("/orders", {
          method: "POST",
          body: {
            customer_email: $("oEmail").value, customer_name: $("oName").value, customer_phone: $("oPhone").value,
            branch_id: $("oBranch").value, payment_status: $("oPayment").value, pickup_date: $("oPickup").value || null, items,
          },
        });
      }
      $("orderDialog").close();
      S.toast("Order saved.", "success");
      const users = await S.api("/admin/users");
      state.users = users.users;
      renderPeople();
      await refreshOrders();
    } catch (err) {
      showError("orderFormError", err.message);
    } finally {
      S.setBusy(btn, false);
    }
  });

  /* ---------- services ---------- */
  function renderServices() {
    $("servicesBody").innerHTML = state.services.length
      ? state.services.map((s) => `<tr data-id="${s.id}">
          <td><div class="row" style="flex-wrap:nowrap">${S.imgTag(s.image_url, "", "avatar")}<div><strong>${S.esc(s.name)}</strong><div class="small muted">${S.esc(s.description || "")}</div></div></div></td>
          <td>${s.pricing_type === "per_kg" ? "Per kg" : "Per piece"}</td>
          <td><input class="price-input" type="number" min="0" step="0.01" value="${Number(s.unit_price)}" aria-label="Price for ${S.esc(s.name)}"></td>
          <td><div class="actions"><button class="btn sm save-price" type="button">Save</button><button class="btn ghost sm edit-service" type="button">Edit</button>${isAdmin ? '<button class="btn danger sm delete-service" type="button">Delete</button>' : ""}</div></td></tr>`).join("")
      : emptyRow(4, "No services yet", "Add your first service so customers can book.");
  }

  $("servicesBody").addEventListener("click", async (e) => {
    const row = e.target.closest("tr[data-id]");
    if (!row) return;
    const service = state.services.find((s) => s.id === row.dataset.id);
    if (e.target.closest(".save-price")) {
      try {
        const price = row.querySelector(".price-input").value;
        const { service: updated } = await S.api("/admin/services/" + service.id, { method: "PATCH", body: { unit_price: price } });
        Object.assign(service, updated);
        S.toast(`${service.name} is now ${S.money(updated.unit_price)}.`, "success");
      } catch (err) { fail(err); }
    } else if (e.target.closest(".edit-service")) {
      openServiceDialog(service);
    } else if (e.target.closest(".delete-service")) {
      if (!confirm(`Delete "${service.name}"?`)) return;
      try {
        await S.api("/admin/services/" + service.id, { method: "DELETE" });
        state.services = state.services.filter((s) => s.id !== service.id);
        renderServices();
        S.toast("Service deleted.", "success");
      } catch (err) { fail(err); }
    }
  });

  function openServiceDialog(service) {
    editingServiceId = service ? service.id : null;
    $("serviceDialogTitle").textContent = service ? "Edit service" : "Add service";
    showError("serviceFormError", "");
    $("sName").value = service ? service.name : "";
    $("sDesc").value = service ? service.description || "" : "";
    $("sType").value = service ? service.pricing_type : "per_kg";
    $("sPrice").value = service ? Number(service.unit_price) : "";
    $("sImage").value = service ? service.image_url || "" : "";
    $("serviceDialog").showModal();
  }
  $("addServiceBtn").addEventListener("click", () => openServiceDialog(null));
  $("serviceForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = { name: $("sName").value, description: $("sDesc").value, pricing_type: $("sType").value, unit_price: $("sPrice").value, image_url: $("sImage").value };
    try {
      if (editingServiceId) await S.api("/admin/services/" + editingServiceId, { method: "PATCH", body });
      else await S.api("/admin/services", { method: "POST", body });
      $("serviceDialog").close();
      state.services = (await S.api("/services")).services;
      renderServices();
      S.toast("Service saved.", "success");
    } catch (err) { showError("serviceFormError", err.message); }
  });

  /* ---------- inventory ---------- */
  function renderInventory() {
    const branch = $("inventoryBranchFilter").value;
    const items = state.inventory.filter((i) => !branch || i.branch_id === branch);
    const low = lowStockList();
    $("inventoryAlert").innerHTML = lowStockAlertHTML();
    $("inventoryBody").innerHTML = items.length
      ? items.map((i) => `<tr data-id="${i.id}">
          <td><strong>${S.esc(i.item_name)}</strong> ${i.is_low ? '<span class="badge low">Low stock</span>' : ""}</td>
          <td>${S.esc((i.branches || {}).name || "")}</td>
          <td>${Number(i.stock_quantity)} ${S.esc(i.unit)}</td>
          <td>${Number(i.reorder_level)} ${S.esc(i.unit)}</td>
          <td><div class="actions" style="justify-content:flex-start"><button class="btn ghost sm adjust" data-delta="-1" type="button" aria-label="Use one ${S.esc(i.unit)}">-1</button><button class="btn ghost sm adjust" data-delta="1" type="button" aria-label="Add one ${S.esc(i.unit)}">+1</button><button class="btn ghost sm adjust" data-delta="10" type="button" aria-label="Add ten ${S.esc(i.unit)}">+10</button></div></td>
          <td><div class="actions"><button class="btn ghost sm edit-inv" type="button">Edit</button><button class="btn danger sm delete-inv" type="button">Delete</button></div></td></tr>`).join("")
      : emptyRow(6, "No supplies tracked", "Add detergent, softener, and bags to get low-stock warnings.");
    void low;
  }
  $("inventoryBranchFilter").addEventListener("change", renderInventory);

  $("inventoryBody").addEventListener("click", async (e) => {
    const row = e.target.closest("tr[data-id]");
    if (!row) return;
    const item = state.inventory.find((i) => i.id === row.dataset.id);
    try {
      if (e.target.closest(".adjust")) {
        await S.api(`/inventory/${item.id}/adjust`, { method: "POST", body: { delta: Number(e.target.closest(".adjust").dataset.delta) } });
        await refreshInventory();
      } else if (e.target.closest(".edit-inv")) {
        openInventoryDialog(item);
      } else if (e.target.closest(".delete-inv")) {
        if (!confirm(`Remove "${item.item_name}" from inventory?`)) return;
        await S.api("/inventory/" + item.id, { method: "DELETE" });
        await refreshInventory();
        S.toast("Supply removed.", "success");
      }
    } catch (err) { fail(err); }
  });

  function openInventoryDialog(item) {
    editingInventoryId = item ? item.id : null;
    $("inventoryDialogTitle").textContent = item ? "Edit supply" : "Add supply";
    showError("inventoryFormError", "");
    $("iBranch").innerHTML = branchOptions(item ? item.branch_id : "");
    $("iName").value = item ? item.item_name : "";
    $("iStock").value = item ? Number(item.stock_quantity) : "";
    $("iUnit").value = item ? item.unit : "";
    $("iReorder").value = item ? Number(item.reorder_level) : "";
    $("inventoryDialog").showModal();
  }
  $("addInventoryBtn").addEventListener("click", () => openInventoryDialog(null));
  $("inventoryForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = { item_name: $("iName").value, branch_id: $("iBranch").value, stock_quantity: $("iStock").value, unit: $("iUnit").value, reorder_level: $("iReorder").value };
    try {
      if (editingInventoryId) await S.api("/inventory/" + editingInventoryId, { method: "PATCH", body });
      else await S.api("/inventory", { method: "POST", body });
      $("inventoryDialog").close();
      await refreshInventory();
      S.toast("Supply saved.", "success");
    } catch (err) { showError("inventoryFormError", err.message); }
  });

  /* ---------- people ---------- */
  function renderPeople() {
    $("peopleHint").textContent = isAdmin
      ? "Switch a person to staff so they can manage orders, or to admin for full control."
      : "Only admins can change roles.";
    $("peopleBody").innerHTML = state.users.map((u) => `<tr data-id="${u.id}">
      <td><div class="row" style="flex-wrap:nowrap"><img class="avatar" src="${S.avatarFor(u.id)}" alt="" onerror="__imgFallback(this)"><strong>${S.esc(u.full_name || "No name")}</strong></div></td>
      <td>${S.esc(u.email)}</td><td>${S.esc(u.phone || "")}</td>
      <td>${isAdmin
        ? `<select class="role-select" aria-label="Role for ${S.esc(u.full_name || u.email)}">${["customer", "staff", "admin"].map((r) => `<option value="${r}" ${r === u.role ? "selected" : ""}>${r[0].toUpperCase() + r.slice(1)}</option>`).join("")}</select>`
        : `<span class="badge">${S.esc(u.role)}</span>`}</td>
      <td>${S.date(u.created_at)}</td></tr>`).join("");
  }
  $("peopleBody").addEventListener("change", async (e) => {
    if (!e.target.classList.contains("role-select")) return;
    try {
      await S.api(`/admin/users/${e.target.closest("tr").dataset.id}/role`, { method: "PATCH", body: { role: e.target.value } });
      S.toast("Role updated.", "success");
      state.users = (await S.api("/admin/users")).users;
    } catch (err) { fail(err); state.users = (await S.api("/admin/users")).users; renderPeople(); }
  });

  /* ---------- branches ---------- */
  function renderBranches() {
    $("branchHint").textContent = isAdmin ? "Each order and supply belongs to a branch." : "Only admins can add or change branches.";
    $("addBranchBtn").hidden = !isAdmin;
    $("branchesBody").innerHTML = state.branches.length
      ? state.branches.map((b) => `<tr data-id="${b.id}"><td><strong>${S.esc(b.name)}</strong></td><td>${S.esc(b.address || "")}</td><td>${S.esc(b.contact_number || "")}</td>
          <td>${isAdmin ? '<div class="actions"><button class="btn ghost sm edit-branch" type="button">Edit</button><button class="btn danger sm delete-branch" type="button">Delete</button></div>' : ""}</td></tr>`).join("")
      : emptyRow(4, "No branches", "Add your first branch to start taking orders.");
    const opts = '<option value="">All branches</option>' + branchOptions("");
    const current = $("inventoryBranchFilter").value;
    $("inventoryBranchFilter").innerHTML = opts;
    $("inventoryBranchFilter").value = current;
  }
  $("branchesBody").addEventListener("click", async (e) => {
    const row = e.target.closest("tr[data-id]");
    if (!row) return;
    const branch = state.branches.find((b) => b.id === row.dataset.id);
    if (e.target.closest(".edit-branch")) openBranchDialog(branch);
    else if (e.target.closest(".delete-branch")) {
      if (!confirm(`Delete ${branch.name}?`)) return;
      try {
        await S.api("/admin/branches/" + branch.id, { method: "DELETE" });
        state.branches = state.branches.filter((b) => b.id !== branch.id);
        renderBranches();
        S.toast("Branch deleted.", "success");
      } catch (err) { fail(err); }
    }
  });
  function openBranchDialog(branch) {
    editingBranchId = branch ? branch.id : null;
    $("branchDialogTitle").textContent = branch ? "Edit branch" : "Add branch";
    showError("branchFormError", "");
    $("bName").value = branch ? branch.name : "";
    $("bAddress").value = branch ? branch.address || "" : "";
    $("bContact").value = branch ? branch.contact_number || "" : "";
    $("branchDialog").showModal();
  }
  $("addBranchBtn").addEventListener("click", () => openBranchDialog(null));
  $("branchForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = { name: $("bName").value, address: $("bAddress").value, contact_number: $("bContact").value };
    try {
      if (editingBranchId) await S.api("/admin/branches/" + editingBranchId, { method: "PATCH", body });
      else await S.api("/admin/branches", { method: "POST", body });
      $("branchDialog").close();
      state.branches = (await S.api("/branches")).branches;
      renderBranches();
      S.toast("Branch saved.", "success");
    } catch (err) { showError("branchFormError", err.message); }
  });

  /* ---------- wiring ---------- */
  document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  document.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.goto)));
  document.querySelectorAll("dialog [data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
  $("orderStatusFilter").innerHTML = '<option value="">All statuses</option>' + S.STATUSES.map((s) => `<option value="${s.key}">${s.label}</option>`).join("");

  async function init() {
    try {
      await S.requireSession(["admin", "staff"]);
    } catch (err) { return fail(err); }
    isAdmin = S.profile.role === "admin";
    S.fillUserChrome();
    $("roleLine").textContent = `Signed in as ${S.profile.role}.`;
    try {
      await loadAll();
    } catch (err) { return fail(err); }
    const hash = location.hash.replace("#", "");
    if (document.getElementById("tab-" + hash)) showTab(hash);

    // realtime: new or changed orders appear without a refresh
    let timer;
    S.sb.channel("shop-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => refreshOrders().catch(() => {}), 700);
      })
      .subscribe();
    S.initNotifications().catch(() => {});
  }

  init();
})();



