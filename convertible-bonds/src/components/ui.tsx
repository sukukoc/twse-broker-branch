import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cinnabar",
  {
    variants: {
      variant: {
        solid: "border-pine bg-pine text-paper hover:bg-ink",
        ghost: "border-transparent bg-transparent text-ink hover:bg-sand",
        line: "border-line bg-card text-ink hover:border-ink",
      },
    },
    defaultVariants: { variant: "line" },
  },
);

export function Button({
  className,
  variant,
  asChild,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant }), className)} {...props} />;
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-10 w-full rounded-xl border border-line bg-card px-3 text-sm outline-none focus:border-pine",
        props.className,
      )}
    />
  );
}

export function Badge({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "ok" | "warn" | "bad";
  children: ReactNode;
}) {
  const tones = {
    muted: "bg-sand text-ink",
    ok: "bg-[#e5f2ea] text-ok",
    warn: "bg-[#f8efdc] text-warn",
    bad: "bg-[#f8e6e4] text-cinnabar",
  };
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function Missing({ children = "未取得" }: { children?: ReactNode }) {
  return <span className="text-muted">{children}</span>;
}
