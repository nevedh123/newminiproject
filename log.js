const API_URL = '/api/auth';
let isLogin = true;

function toggleAuthMode() {
  isLogin = !isLogin;
  const title = document.getElementById('form-title');
  const btn = document.getElementById('auth-btn');
  const toggleText = document.getElementById('toggle-text');
  const nameInput = document.getElementById('name');

  if (isLogin) {
    title.innerText = 'Welcome Back';
    btn.innerText = 'Login';
    toggleText.innerText = 'New here? Create an account';
    nameInput.style.display = 'none';
  } else {
    title.innerText = 'Create Account';
    btn.innerText = 'Register';
    toggleText.innerText = 'Already have an account? Login';
    nameInput.style.display = 'block';
  }
}

async function handleAuth() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const name = document.getElementById('name').value;
  const status = document.getElementById('status');

  if (!email || !password) {
    status.innerText = "Please fill in all fields";
    return;
  }

  const endpoint = isLogin ? '/login' : '/register';
  const body = isLogin ? { email, password } : { name, email, password };

  try {
    const response = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (response.ok) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));

      // Redirect based on role and port
      if (data.user && data.user.role === 'admin') {
          console.log("Admin detected, redirecting...");
          // If accessing via port 3001 or any port if we want to force admin panel
          if (window.location.port === '3001') {
              window.location.href = 'admin-panel.html';
          } else {
              window.location.href = 'admin.html';
          }
      } else {
          console.log("Consumer detected, redirecting to index...");
          window.location.href = 'index.html';
      }
    } else {
      status.innerText = data.message || "Authentication failed";
    }
  } catch (error) {
    status.innerText = "Server error. Ensure backend is running.";
    console.error(error);
  }
}
