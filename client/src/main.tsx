import { createBrowserRouter, RouterProvider } from "react-router-dom";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./pages/App";
import { Test } from "./pages/Test";

const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <React.StrictMode>
        <App />
      </React.StrictMode>
    ),
  },
  {
    path: "/test",
    element: <Test />,
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
