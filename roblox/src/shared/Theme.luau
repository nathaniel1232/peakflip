-- One small palette and one clean look for everything: smooth plastic everywhere, neon only for
-- things that glow. The UI and the world draw their colours from here.
local hex = Color3.fromHex

local Theme = {
	-- the few colours the game uses
	primary = hex("2f8cff"), -- buttons, headers, accents
	primaryDark = hex("1c5fc0"),
	gold = hex("ffc83d"), -- coins and highlights
	green = hex("34c759"), -- play / buy
	red = hex("ff453a"), -- close / danger
	ink = hex("13203a"), -- outlines, dark text
	panel = hex("1d2c47"), -- window backgrounds
	panel2 = hex("2a3d5f"), -- cards, inactive tabs
	white = hex("ffffff"),
	snow = hex("f4f7fb"),
	snowShade = hex("dde6ef"),
	-- the lodge
	wood = hex("b9824e"),
	woodDark = hex("8a5a33"),
	cream = hex("f1e8d8"),
	stone = hex("a3abb5"),
	fabric = hex("2a4a7f"),
	warmLight = hex("ffd9a6"),
}

-- Smooth plastic for everything, except glowing things.
function Theme.material(glow: boolean?): Enum.Material
	return if glow then Enum.Material.Neon else Enum.Material.SmoothPlastic
end

return Theme
