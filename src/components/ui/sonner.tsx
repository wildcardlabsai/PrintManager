"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="top-right"
      closeButton
      toastOptions={{
        classNames: {
          toast: "!rounded-md !border !border-border !bg-card !text-foreground !shadow-md !text-sm",
          description: "!text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
