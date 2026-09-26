import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { App } from "@/App";
import { TooltipProvider } from "@/components/ui/overlays";
import { ApiError } from "@/lib/api";
import { ThemeProvider, useTheme } from "@/lib/theme";
import "@/index.css";

/** Any 401 from the server means the session ended: drop it, and the route guard sends the user to sign in. */
function createClient(): QueryClient {
  const expire = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) client.setQueryData(["session"], null);
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: expire }),
    mutationCache: new MutationCache({ onError: expire }),
    defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 15_000, retry: 1 } },
  });
  return client;
}

function ThemedToaster() {
  const { resolved } = useTheme();
  return <Toaster theme={resolved} position="bottom-right" closeButton />;
}

const client = createClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
          <ThemedToaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
