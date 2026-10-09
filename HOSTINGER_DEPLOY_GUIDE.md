# 🚀 Hostinger Deployment Guide - Meesho Order Manager (Node.js)

આ ગાઈડની મદદથી તમે **Meesho Order Manager (Node.js)** ને **Hostinger** પર આસાનીથી અને 100% યોગ્ય રીતે ડિપ્લોય કરી શકો છો.

---

## 📌 મહત્વપૂર્ણ જાણકારી (Playwright & Hostinger)

Meesho Order Manager માં બ્રાઉઝર ઓટોમેશન (**Playwright Chromium**) નો ઉપયોગ થાય છે.
Hostinger પર ડિપ્લોય કરવા માટે બે મુખ્ય રીતો છે:

1. **Option A: Hostinger VPS (સૌથી શ્રેષ્ઠ અને 100% Recommended)** ⭐
   - કિંમત: ₹400-500/મહિનો (KVM 1 કે KVM 2).
   - ફાયદો: બ્રાઉઝર ઓટોમેશન, Docker, 24/7 બેકગ્રાઉન્ડ Scheduler કોઈપણ લિમિટ વગર ફાસ્ટ ચાલે છે.
2. **Option B: Hostinger Cloud / Web Hosting (Node.js Application Manager)**
   - hPanel માં Node.js સપોર્ટ હોય તો ચાલે.

---

## 🟢 Method 1: Hostinger VPS પર Deployment (Using PM2)

### 1. VPS માં Login કરો (SSH દ્વારા)
તમારા કમ્પ્યુટરમાંથી PowerShell અથવા Terminal ખોલો:
```bash
ssh root@YOUR_SERVER_IP
```

### 2. Node.js અને Git ઇન્સ્ટોલ કરો (જો ન હોય તો)
```bash
# Node.js 20 LTS ઇન્સ્ટોલ કરો
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

# PM2 પ્રોસેસ મેનેજર ઇન્સ્ટોલ કરો
npm install -g pm2
```

### 3. પ્રોજેક્ટ ફાઇલો VPS પર લાવો
તમારી GitHub repo ક્લોન કરો:
```bash
cd /var/www
git clone https://github.com/HemalBoghara/meesho-order-manager.git
cd meesho-order-manager
```
*(અથવા FileZilla / WinSCP દ્વારા આખા ફોલ્ડરની ફાઈલો અપલોડ કરી શકો છો)*

### 4. Dependencies અને Chromium ઇન્સ્ટોલ કરો
```bash
# NPM પેકેજો ઇન્સ્ટોલ કરો
npm install

# Playwright માટે લિનક્સ સિસ્ટમ લાઈબ્રેરીઓ અને Chromium ઇન્સ્ટોલ કરો:
npx playwright install --with-deps chromium
```

### 5. Environment File (.env) સેટ કરો
```bash
cp .env.example .env
nano .env
```
`.env` ફાઇલમાં નીચે મુજબ હોવું જોઈએ:
```env
PORT=8000
HOST=0.0.0.0
HEADLESS=true
NODE_ENV=production
```
*(Ctrl + O દબાવીને Enter કરો, પછી Ctrl + X થી બહાર નીકળો)*

### 6. PM2 થી 24/7 સર્વર ચાલુ કરો
```bash
# PM2 થી એપ શરૂ કરો
pm2 start ecosystem.config.js --env production

# સિસ્ટમ રીબુટ થાય ત્યારે પણ આપમેળે ચાલુ રહે તે માટે:
pm2 save
pm2 startup
```

### 7. સ્ટેટસ અને લાઇવ લોગ્સ જુઓ
```bash
pm2 status
pm2 logs meesho-order-manager
```
બસ! હવે તમારા બ્રાઉઝરમાં ખોલો:
👉 `http://YOUR_SERVER_IP:8000`

---

## 🐳 Method 2: Hostinger VPS પર Docker દ્વારા (સૌથી સરળ - 1 કમાન્ડ)

જો તમારા VPS માં Docker ઇન્સ્ટોલ હોય, તો કોઈ લાયબ્રેરીની ચિંતા વગર ફક્ત આ એક કમાન્ડ ચલાવો:

```bash
docker compose up -d --build
```
- બધું જ આપમેળે ઇન્સ્ટોલ થઈ જશે.
- કન્ટેનર બેકગ્રાઉન્ડમાં 24/7 ચાલશે.

---

## 🌐 ડૉમેઇન અથવા SSL (HTTPS) સેટ કરવું (Nginx Reverse Proxy)

જો તમારે `http://YOUR_SERVER_IP:8000` ની જગ્યાએ તમારું પોતાનું ડોમેન (દા.ત. `order.yourdomain.com`) જોડવું હોય:

```bash
sudo apt install nginx -y
sudo nano /etc/nginx/sites-available/meesho
```

નીચેનો કોડ પેસ્ટ કરો:
```nginx
server {
    listen 80;
    server_name order.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

સક્ષમ કરો અને Nginx રીસ્ટાર્ટ કરો:
```bash
sudo ln -s /etc/nginx/sites-available/meesho /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

ફ્રી SSL સર્ટિફિકેટ (HTTPS) ઇન્સ્ટોલ કરો:
```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d order.yourdomain.com
```

---

## 🛠️ લોકલ ટેસ્ટિંગ (Local Machine)
તમારા પોતાના કમ્પ્યુટરમાં Node.js વર્ઝન ચલાવવા માટે:
```powershell
# Dependencies ઇન્સ્ટોલ કરો
npm install

# Playwright Chromium ઇન્સ્ટોલ કરો
npx playwright install chromium

# સર્વર ચાલુ કરો
npm start
```
અથવા **`start-node.bat`** ફાઇલ પર ડબલ ક્લિક કરો.
Local URL: `http://127.0.0.1:8000`
