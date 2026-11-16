# Sudsy: laundry and dry cleaning management for small shops

Sudsy lets a laundry shop take drop-offs, move each order through washing, drying, and pickup, and keep customers informed automatically. Customers book online with a live price calculator and watch a progress tracker update in real time. Staff get one dashboard for orders, prices, supplies, people, and branches.

**Stack:** HTML, CSS, and vanilla JavaScript on the front end (Supabase JS SDK for sign-in and realtime), Flask on the back end (official Supabase Python client), and Supabase PostgreSQL for data.

## Features

- **Sign-up and sign-in** with Supabase Auth, persistent sessions, and role-based redirects (customers go to `dashboard.html`, admins and staff go to `admin.html`).
- **Order lifecycle**: staff create, view, edit, and delete orders, change status (received, washing, drying, ready, completed), toggle payment, and walk-in customers get an account created automatically.
- **Customer booking** with a weight and item calculator. Prices are always recalculated on the server from the current price list.
- **Live status tracker** for customers, updated through Supabase Realtime, plus an in-app notification bell.
- **Automatic notifications** when an order is placed, changes status, or is paid. Staff are notified when supplies fall below their reorder level.
- **Inventory** per branch with low-stock warnings, quick +/- adjustments, and edit/delete.
- **Price management**: admins and staff edit service prices inline. Only admins delete services, manage branches, and change roles.

## Project layout

```
laundry_sme/
├── backend/
│   ├── app.py                  Flask app factory, serves the API and the frontend
│   ├── config.py               Environment settings and the Supabase service client
│   ├── routes/
│   │   ├── __init__.py         Auth decorators (login_required, staff_required, admin_required)
│   │   ├── auth_routes.py      /api/config, /api/auth/me, profile, notifications
│   │   ├── order_routes.py     Orders, services and branches lookups
│   │   ├── inventory_routes.py Inventory and low-stock detection
│   │   └── admin_routes.py     Stats, services, branches, users and roles
│   └── services/notification_service.py
├── database/schema.sql         7 tables, indexes, RLS policies, triggers, realtime
├── database/seed.sql           Sample branches, services, and supplies
├── frontend/                   index, login, register, dashboard, admin + css/js
├── render.yaml  requirements.txt  .env.example  .gitignore
```

## Setup

### 1. Create the Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste all of `database/schema.sql`, and run it.
3. Paste and run `database/seed.sql` for sample data (optional but recommended).
4. Open **Project Settings > API** and copy the Project URL, the `anon` public key, and the `service_role` secret key.
5. Optional for local testing: under **Authentication > Providers > Email**, turn off "Confirm email" so new accounts can sign in immediately.

### 2. Run locally

```bash
cd laundry_sme
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # then fill in your three Supabase values
python -m backend.app
```

Open http://localhost:5000. Flask serves both the API and the frontend, so there is nothing else to start.

### 3. Create your first admin

Sign up through the app, then run this once in the Supabase SQL Editor (use your email):

```sql
update public.users set role = 'admin' where email = 'you@example.com';
```

Sign out and back in. You will land on the shop dashboard. From the **People** tab you can promote other accounts to staff or admin. Sign-up always creates a customer, so nobody can grant themselves elevated access.

### 4. Deploy to Render

1. Push this folder to a GitHub repository.
2. In Render, choose **New > Blueprint** and select the repository. `render.yaml` configures everything.
3. Fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` when prompted.
4. In Supabase, go to **Authentication > URL Configuration** and add your Render URL as the Site URL so confirmation emails link back correctly.

## How security works

- The browser only ever receives the public `anon` key, served from `/api/config`.
- The `service_role` key stays on the server. The API checks every request's Supabase access token, loads the user's role, and enforces permissions before touching data.
- Row Level Security is enabled on all seven tables, so direct browser queries (including realtime) are limited to the signed-in customer's own rows, or to staff where appropriate.
- Order totals are computed on the server from stored prices. Clients cannot set their own prices.

## API summary

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/public/services` | Anyone |
| GET | `/api/auth/me`, `/api/services`, `/api/branches`, `/api/notifications` | Signed in |
| POST | `/api/orders` | Customer (own) or staff (any customer) |
| GET | `/api/orders` | Customer (own) or staff (all) |
| PATCH, DELETE | `/api/orders/<id>` | Staff |
| GET, POST, PATCH, DELETE | `/api/inventory`, `/api/inventory/<id>`, `/api/inventory/<id>/adjust`, `/api/inventory/low-stock` | Staff |
| GET | `/api/admin/stats`, `/api/admin/users` | Staff |
| POST, PATCH | `/api/admin/services` | Staff |
| DELETE | `/api/admin/services/<id>` | Admin |
| POST, PATCH, DELETE | `/api/admin/branches` | Admin |
| PATCH | `/api/admin/users/<id>/role` | Admin |

## Troubleshooting

- **"Server is missing Supabase settings"**: check that all three variables in `.env` are set, then restart.
- **Sign-up works but no confirmation email arrives**: Supabase's built-in mailer is rate limited. Turn off email confirmation for development, or configure custom SMTP.
- **Live updates do not appear**: confirm the last section of `schema.sql` ran, which adds `orders` and `notifications` to the realtime publication.
- **Currency**: prices display in Philippine pesos. To change it, edit `Sudsy.money` in `frontend/js/app.js`.
