// js/auth.js
import { api } from "./api.js";
import { loadWorkouts } from "./workouts.js";
import { loadVolume } from "./volume.js";
import { loadAcwr } from "./acwr.js";
import { loadHrDistribution } from "./hr-distribution.js";
import { loadWellness } from "./wellness.js";
import { loadEvolutionData } from "./evolution.js";
import { resetDashGreeting } from "./dash-greeting.js";
import { resetHistory } from "./history.js";

const loginView = document.getElementById("login-view");
const dashboardView = document.getElementById("dashboard-view");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const loginSubmit = document.getElementById("login-submit");
const passwordInput = document.getElementById("password");
const passwordToggle = document.getElementById("password-toggle");
const passwordToggleIcon = document.getElementById("password-toggle-icon");
const logoutBtn = document.getElementById("logout-btn");

export function showDashboard() {
  loginView.style.display = "none";
  dashboardView.style.display = "block";
  logoutBtn.style.display = "inline-block";
  resetDashGreeting();
  resetHistory();
  document.getElementById("tab-tracking")?.classList.add("enter");
  loadWorkouts();
  loadVolume();
  loadAcwr();
  loadHrDistribution();
  loadWellness();
  loadEvolutionData();
}

export function showLogin() {
  loginView.style.display = "block";
  dashboardView.style.display = "none";
  logoutBtn.style.display = "none";
}

export function initAuth() {
  passwordToggle.addEventListener("click", () => {
    const isVisible = passwordInput.type === "text";
    passwordInput.type = isVisible ? "password" : "text";
    passwordToggle.setAttribute("aria-pressed", String(!isVisible));
    passwordToggle.setAttribute("aria-label", isVisible ? "Afficher le mot de passe" : "Masquer le mot de passe");
    passwordToggleIcon.innerHTML = isVisible
      ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>'
      : '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.9 18.9 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a18.9 18.9 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.style.display = "none";
    loginSubmit.disabled = true;
    loginSubmit.textContent = "Connexion…";

    try {
      await api("/api/login", {
        method: "POST",
        body: JSON.stringify({
          email: document.getElementById("email").value,
          password: document.getElementById("password").value,
        }),
      });
      showDashboard();
    } catch (err) {
      loginError.textContent = err.message;
      loginError.style.display = "block";
    } finally {
      loginSubmit.disabled = false;
      loginSubmit.textContent = "Se connecter";
    }
  });

  logoutBtn.addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" }).catch(() => {});
    showLogin();
  });
}
