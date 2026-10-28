// Server lokal untuk development (di Vercel yang dipakai api/index.js)
import app from "./api/index.js";
const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`API jalan di http://localhost:${port}`));
