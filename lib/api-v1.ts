import axios from "axios";

export const apiV1 = axios.create({
  baseURL: "/api/v1",
  headers: { "Content-Type": "application/json" },
  timeout: 60_000,
});
