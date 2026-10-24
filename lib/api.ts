import axios from "axios";

export const api = axios.create({
  baseURL: "/api/auth",
  headers: { "Content-Type": "application/json" },
  timeout: 15_000,
});