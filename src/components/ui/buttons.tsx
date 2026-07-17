import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

export function PrimaryButton({ children, className = "", ...props }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) {
  return <button className={`primary-button ${className}`} {...props}>{children}</button>;
}

export function SecondaryButton({ children, className = "", ...props }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) {
  return <button className={`secondary-button ${className}`} {...props}>{children}</button>;
}
