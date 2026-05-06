# FluxyOS Project

The intelligent financial operating system for modern businesses.

## 🏗 Project Structure

```text
fluxionos/
├── assets/
│   ├── css/          # Extracted CSS for each page
│   └── js/           # Extracted JS logic
├── api/              # Backend API (Python/FastAPI)
│   ├── main.py       # API entry point
│   └── requirements.txt
├── .env.example      # Security configuration template
└── *.html            # Cleaned HTML pages
```

## 🚀 Getting Started

### 1. Frontend
Simply open `fluxyos.html` in your browser. All styles and logic are now organized in the `assets/` folder.

### 2. Backend (API)
To run the security and data layer:
1. Navigate to the `api/` folder.
2. Install dependencies: `pip install -r requirements.txt`
3. Start the server: `python main.py`

### 3. Security
1. Copy `.env.example` to `.env`.
2. Update your secret keys and database URLs.

## 🔒 Security Features
- **CORS Enabled**: Restricts unauthorized domains from accessing your data.
- **Environment Isolation**: Secrets are kept out of the codebase using `.env`.
- **JWT Ready**: Skeleton included for token-based authentication.
