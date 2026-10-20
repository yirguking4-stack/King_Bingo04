// Brand icons (public/icons/*.png): bingo, ludo, wallet
export default function GameIcon({ name, size = 44, style }) {
  return (
    <img
      src={`/icons/${name}.png`}
      alt={name}
      width={size}
      height={size}
      draggable={false}
      style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0, ...style }}
    />
  );
}
