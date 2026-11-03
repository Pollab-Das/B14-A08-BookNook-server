# B14-A08-BookNook-server
---

### 📁 ২. `booknook-server` 

```markdown
# BookNook - Server API

This repository contains the **Backend (Server)** code for the BookNook online library application. It is a RESTful API built with Express.js and MongoDB, featuring JWT protection.

## 🔥 Key Features (API)
- **JWT Protection:** Secure API routes using `jose` and BetterAuth's JWKS to verify tokens for protected endpoints.
- **Book CRUD Operations:** Public routes to fetch books, and protected routes to add, update, and delete books.
- **Borrow System Logic:** Endpoints to handle borrowing and returning books. Includes logic to prevent double borrowing and uses MongoDB `$inc` to decrease/increase available copies.
- **MongoDB Integration:** Efficient data querying and storage using the official MongoDB Node.js driver.

## 🛠️ Tech Stack
- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** MongoDB (Native Driver)
- **Authentication:** JWT (JSON Web Tokens) via `jose`
- **Configuration:** `dotenv`, `cors`

## 🚀 How to Run Locally
1. Clone the repository:
   ```bash
   git clone <https://github.com/Pollab-Das/B14-A08-BookNook-server>
