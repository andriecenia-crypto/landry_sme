/* Landing price list, sign-up, sign-in, and role-based redirects. */
(function () {
  const $ = (id) => document.getElementById(id);

  function showMessage(text, kind) {
    const box = $("formMessage");
    if (!box) return Sudsy.toast(text, kind === "ok" ? "success" : "error");
    box.className = kind === "ok" ? "form-ok" : "form-error";
    box.textContent = text;
    box.hidden = false;
  }

  function friendly(message) {
    const m = String(message || "");
    if (/invalid login credentials/i.test(m)) return "That email and password don't match. Check them and try again.";
    if (/already registered/i.test(m)) return "An account with this email already exists. Try signing in.";
    if (/email not confirmed/i.test(m)) return "Confirm your email first. We sent you a link.";
    if (/password should be at least/i.test(m)) return "Use a password with at least 8 characters.";
    return m || "Something went wrong. Try again.";
  }

  async function redirectByRole() {
    const { user } = await Sudsy.api("/auth/me");
    window.location.href = Sudsy.homeFor(user.role);
  }

  async function landing(session) {
    if (session) {
      const login = $("navLogin");
      const cta = $("navCta");
      login.textContent = "Open dashboard";
      login.href = "/dashboard.html";
      cta.hidden = true;
      Sudsy.api("/auth/me").then(({ user }) => { login.href = Sudsy.homeFor(user.role); }).catch(() => {});
    }
    const box = $("landingServices");
    try {
      const res = await fetch("/api/public/services");
      const { services } = await res.json();
      box.innerHTML = services
        .map(
          (s) => `<article class="service">${Sudsy.imgTag(s.image_url, s.name)}<div class="service-body">
            <h3>${Sudsy.esc(s.name)}</h3><p class="muted small">${Sudsy.esc(s.description || "")}</p>
            <div class="price">${Sudsy.money(s.unit_price)} <small>per ${Sudsy.unitLabel(s.pricing_type) === "kg" ? "kg" : "piece"}</small></div></div></article>`
        )
        .join("") || '<p class="muted">The price list will appear here once the shop adds services.</p>';
    } catch (_) {
      box.innerHTML = '<p class="muted">We couldn\'t load the price list. Refresh to try again.</p>';
    }
  }

  async function init() {
    try {
      await Sudsy.init();
    } catch (err) {
      showMessage(err.message, "error");
      return;
    }
    const { data } = await Sudsy.sb.auth.getSession();
    const session = data.session;

    if ($("landingServices")) return landing(session);

    if (new URLSearchParams(location.search).get("expired")) {
      showMessage("Your session expired. Sign in again to continue.", "error");
    } else if (session) {
      return redirectByRole().catch(() => {});
    }

    const loginForm = $("loginForm");
    if (loginForm) {
      loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = loginForm.querySelector("button[type=submit]");
        const email = $("email").value.trim();
        const password = $("password").value;
        if (!email || !password) return showMessage("Enter your email and password.", "error");
        Sudsy.setBusy(btn, true, "Signing in...");
        const { error } = await Sudsy.sb.auth.signInWithPassword({ email, password });
        if (error) {
          Sudsy.setBusy(btn, false);
          return showMessage(friendly(error.message), "error");
        }
        try { await redirectByRole(); } catch (err) { Sudsy.setBusy(btn, false); showMessage(err.message, "error"); }
      });
    }

    const registerForm = $("registerForm");
    if (registerForm) {
      registerForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = registerForm.querySelector("button[type=submit]");
        const full_name = $("fullName").value.trim();
        const email = $("email").value.trim();
        const phone = $("phone").value.trim();
        const password = $("password").value;
        if (!full_name) return showMessage("Enter your full name.", "error");
        if (!email) return showMessage("Enter your email address.", "error");
        if (password.length < 8) return showMessage("Use a password with at least 8 characters.", "error");
        Sudsy.setBusy(btn, true, "Creating account...");
        const { data: result, error } = await Sudsy.sb.auth.signUp({
          email,
          password,
          options: { data: { full_name, phone }, emailRedirectTo: window.location.origin + "/login.html" },
        });
        Sudsy.setBusy(btn, false);
        if (error) return showMessage(friendly(error.message), "error");
        if (result.session) {
          try { await redirectByRole(); } catch (err) { showMessage(err.message, "error"); }
        } else {
          registerForm.reset();
          showMessage("Account created. Check your email for a confirmation link, then sign in.", "ok");
        }
      });
    }
  }

  init();
})();


