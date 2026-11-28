import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon } from "./Icon";

/** The outlined small pill (Play, Open, Stop). The class is exported so a link can wear it too. */
export const OUTLINE_BUTTON = "obtn";
/** The filled primary pill ("Make the video"). `wide` fills its row, as at the foot of a phone sheet. */
export const PRIMARY_BUTTON = "pbtn";

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & { children: ReactNode; icon?: string };

export function OutlineButton({ children, icon, className, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} className={`${OUTLINE_BUTTON}${className ? ` ${className}` : ""}`} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

export function PrimaryButton({ children, icon, wide, className, type = "button", ...rest }: ButtonProps & { wide?: boolean }) {
  return (
    <button type={type} className={`${PRIMARY_BUTTON}${wide ? " wide" : ""}${className ? ` ${className}` : ""}`} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

/**
 * The small Copy pill. A press puts `text` on the clipboard, then for a moment the pill turns green with a check
 * and says "Copied", so the person can see it worked; a failed copy changes nothing. `label` names it for a
 * screen reader when the text beside it is not enough ("Copy reply").
 */
export function CopyButton({ text, label, className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className={`mini copybtn${copied ? " copied" : ""}${className ? ` ${className}` : ""}`}
      aria-label={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => setCopied(true),
          () => undefined,
        );
      }}
    >
      <Icon name={copied ? "check" : "copy"} key={copied ? "check" : "copy"} />
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
