import { memo } from "react";
// Pixel-art icon set (pixelarticons, MIT) — one visual language for every
// glyph in the arcade, replacing the mixed-style emoji. Icons are inlined as
// raw SVG (fill: currentColor) so they inherit text color and size (1em).
import alien from "pixelarticons/svg/alien.svg?raw";
import arrowDown from "pixelarticons/svg/arrow-down.svg?raw";
import arrowUp from "pixelarticons/svg/arrow-up.svg?raw";
import article from "pixelarticons/svg/article.svg?raw";
import bell from "pixelarticons/svg/bell.svg?raw";
import bellRing from "pixelarticons/svg/bell-ring.svg?raw";
import calendar from "pixelarticons/svg/calendar.svg?raw";
import card from "pixelarticons/svg/card.svg?raw";
import check from "pixelarticons/svg/check.svg?raw";
import checkbox from "pixelarticons/svg/checkbox.svg?raw";
import chevronRight from "pixelarticons/svg/chevron-right.svg?raw";
import circle from "pixelarticons/svg/circle.svg?raw";
import clock from "pixelarticons/svg/clock.svg?raw";
import close from "pixelarticons/svg/close.svg?raw";
import coins from "pixelarticons/svg/coins.svg?raw";
import copy from "pixelarticons/svg/copy.svg?raw";
import crown from "pixelarticons/svg/crown.svg?raw";
import eye from "pixelarticons/svg/eye.svg?raw";
import eyeOff from "pixelarticons/svg/eye-off.svg?raw";
import flag from "pixelarticons/svg/flag.svg?raw";
import frown from "pixelarticons/svg/frown.svg?raw";
import gamepad from "pixelarticons/svg/gamepad.svg?raw";
import globe from "pixelarticons/svg/globe.svg?raw";
import grid3x3 from "pixelarticons/svg/grid-3x3.svg?raw";
import hand from "pixelarticons/svg/hand.svg?raw";
import human from "pixelarticons/svg/human.svg?raw";
import lightbulb from "pixelarticons/svg/lightbulb.svg?raw";
import logout from "pixelarticons/svg/logout.svg?raw";
import lock from "pixelarticons/svg/lock.svg?raw";
import login from "pixelarticons/svg/login.svg?raw";
import mail from "pixelarticons/svg/mail.svg?raw";
import megaphone from "pixelarticons/svg/megaphone.svg?raw";
import meh from "pixelarticons/svg/meh.svg?raw";
import message from "pixelarticons/svg/message-text.svg?raw";
import mic from "pixelarticons/svg/mic.svg?raw";
import moon from "pixelarticons/svg/moon.svg?raw";
import partyPopper from "pixelarticons/svg/party-popper.svg?raw";
import play from "pixelarticons/svg/play.svg?raw";
import plus from "pixelarticons/svg/plus.svg?raw";
import pointer from "pixelarticons/svg/pointer.svg?raw";
import repeat from "pixelarticons/svg/repeat.svg?raw";
import search from "pixelarticons/svg/search.svg?raw";
import send from "pixelarticons/svg/send.svg?raw";
import settings from "pixelarticons/svg/settings-2.svg?raw";
import share from "pixelarticons/svg/share.svg?raw";
import shield from "pixelarticons/svg/shield.svg?raw";
import shuffle from "pixelarticons/svg/shuffle.svg?raw";
import skull from "pixelarticons/svg/skull.svg?raw";
import smartphone from "pixelarticons/svg/smartphone.svg?raw";
import smile from "pixelarticons/svg/smile.svg?raw";
import sparkle from "pixelarticons/svg/sparkle.svg?raw";
import square from "pixelarticons/svg/square.svg?raw";
import star from "pixelarticons/svg/star.svg?raw";
import sunglasses from "pixelarticons/svg/sunglasses.svg?raw";
import sword from "pixelarticons/svg/sword.svg?raw";
import target from "pixelarticons/svg/target.svg?raw";
import trash from "pixelarticons/svg/trash.svg?raw";
import trophy from "pixelarticons/svg/trophy.svg?raw";
import tv from "pixelarticons/svg/tv.svg?raw";
import unlock from "pixelarticons/svg/unlock.svg?raw";
import user from "pixelarticons/svg/user.svg?raw";
import userPlus from "pixelarticons/svg/user-plus.svg?raw";
import users from "pixelarticons/svg/users.svg?raw";
import warning from "pixelarticons/svg/warning-diamond.svg?raw";
import zap from "pixelarticons/svg/zap.svg?raw";

const ICONS = {
  alien,
  "arrow-down": arrowDown,
  "arrow-up": arrowUp,
  article,
  bell,
  "bell-ring": bellRing,
  calendar,
  card,
  check,
  checkbox,
  "chevron-right": chevronRight,
  circle,
  clock,
  close,
  coins,
  copy,
  crown,
  eye,
  "eye-off": eyeOff,
  flag,
  frown,
  gamepad,
  globe,
  "grid-3x3": grid3x3,
  hand,
  human,
  lightbulb,
  lock,
  logout,
  login,
  mail,
  megaphone,
  meh,
  message,
  mic,
  moon,
  "party-popper": partyPopper,
  play,
  plus,
  pointer,
  repeat,
  search,
  send,
  settings,
  share,
  shield,
  shuffle,
  skull,
  smartphone,
  smile,
  sparkle,
  square,
  star,
  sunglasses,
  sword,
  target,
  trash,
  trophy,
  tv,
  unlock,
  user,
  "user-plus": userPlus,
  users,
  warning,
  zap,
} as const;

export type IconName = keyof typeof ICONS;

interface Props {
  name: IconName;
  /** CSS font-size override; icons are 1em and follow the text by default. */
  size?: string | number;
  className?: string;
  /** Accessible label when the icon stands alone (otherwise decorative). */
  label?: string;
}

function Icon({ name, size, className, label }: Props) {
  return (
    <span
      className={className ? `icon ${className}` : "icon"}
      style={size !== undefined ? { fontSize: size } : undefined}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

export default memo(Icon);
