"use client";

import { useRef, useState } from "react";
import { ImageIcon, Loader2Icon, StarIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { makePrimaryImageAction, removeProductImageAction, uploadProductImageAction } from "@/actions/products";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import type { ProductImage } from "@/types/db";

export function ImagesPanel({ productId, images }: { productId: string; images: ProductImage[] }) {
  const { pending, execute } = useAction();
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");

  async function upload(file: File) {
    const fd = new FormData();
    fd.set("file", file);
    await execute(() => uploadProductImageAction(productId, fd));
    if (fileRef.current) fileRef.current.value = "";
  }

  async function addUrl(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("url", url);
    const r = await execute(() => uploadProductImageAction(productId, fd));
    if (r.ok) setUrl("");
  }

  return (
    <section className="rounded-lg border bg-card">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Images</h2>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => fileRef.current?.click()}>
          {pending ? <Loader2Icon className="animate-spin" /> : <UploadIcon />} Upload
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="sr-only"
          aria-label="Upload product image"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
      </header>
      <div className="space-y-3 p-4">
        {images.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ImageIcon className="size-4" /> No images yet.
          </div>
        ) : (
          <ul className="grid grid-cols-3 gap-2">
            {images.map((img, i) => (
              <li key={img.id} className="group relative aspect-square overflow-hidden rounded-md border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.alt ?? ""} className="size-full object-cover" />
                {i === 0 && (
                  <span className="absolute top-1 left-1 rounded bg-card/90 px-1 text-[10px] font-medium">Primary</span>
                )}
                <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/50 p-1 opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                  {i > 0 && (
                    <Button
                      size="icon-sm"
                      variant="secondary"
                      className="size-7"
                      aria-label="Make primary image"
                      onClick={() => execute(() => makePrimaryImageAction(productId, img.id))}
                    >
                      <StarIcon />
                    </Button>
                  )}
                  <ConfirmButton
                    title="Remove this image?"
                    destructive
                    confirmLabel="Remove"
                    onConfirm={() => execute(() => removeProductImageAction(productId, img.id))}
                    trigger={
                      <Button size="icon-sm" variant="secondary" className="size-7" aria-label="Remove image">
                        <Trash2Icon />
                      </Button>
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={addUrl} className="flex gap-2">
          <Input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="…or paste an https image URL"
            aria-label="Image URL"
            className="h-8"
          />
          <Button type="submit" size="sm" variant="outline" disabled={!url || pending}>
            Add
          </Button>
        </form>
      </div>
    </section>
  );
}
