-- Sound effects and music: the web game's own synth sounds, rendered by tools/make_sounds.py and
-- uploaded by tools/upload_assets.py (ids in shared/Sounds.luau). No stock Roblox sounds; anything
-- not uploaded yet is simply silent.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local SoundService = game:GetService("SoundService")

local Shared = ReplicatedStorage:WaitForChild("PeakFlip")
local Config = require(Shared:WaitForChild("Config"))
local Sounds = require(Shared:WaitForChild("Sounds"))

local Sfx = { muted = false, musicOn = true }

local group = Instance.new("SoundGroup")
group.Name = "PeakFlip"
group.Volume = 0.8
group.Parent = SoundService

local sounds: { [string]: Sound } = {}
for name, id in Sounds do
	if name ~= "music" then
		local s = Instance.new("Sound")
		s.Name = name
		s.SoundId = id
		s.SoundGroup = group
		s.Parent = group
		sounds[name] = s
	end
end

local music = Instance.new("Sound")
music.Name = "Music"
music.Looped = true
music.Volume = 0.4
music.SoundId = Sounds.music or Config.MUSIC_ID or ""
music.Parent = SoundService

local last: { [string]: number } = {}
local function play(name: string, volume: number, speed: number?)
	local s = sounds[name]
	if Sfx.muted or not s then
		return
	end
	-- the same sound twice within 60 ms is one sound (coin bursts don't pile up)
	local now = os.clock()
	if now - (last[name] or -1) < 0.06 then
		return
	end
	last[name] = now
	s.Volume = volume
	s.PlaybackSpeed = speed or 1
	SoundService:PlayLocalSound(s)
end

function Sfx.ollie()
	play("ollie", 0.6)
end
function Sfx.land(hard: boolean)
	play("land", if hard then 0.9 else 0.55)
end
function Sfx.coin()
	play("coin", 0.5)
end
function Sfx.trick(size: number)
	play("trick", 0.6, 1 + math.min(size, 3) * 0.06)
end
function Sfx.perfect()
	play("perfect", 0.7)
end
function Sfx.near()
	play("near", 0.45)
end
function Sfx.crash()
	play("crash", 0.8)
end
function Sfx.revive()
	play("reward", 0.6)
end
function Sfx.splash() end

-- ui
function Sfx.click()
	play("click", 0.5)
end
function Sfx.hover() end
function Sfx.open()
	play("click", 0.4, 0.8)
end
function Sfx.error()
	play("click", 0.5, 0.6)
end
function Sfx.buy()
	play("reward", 0.6)
end
function Sfx.reward()
	play("reward", 0.6)
end
function Sfx.beep(final: boolean)
	play(if final then "perfect" else "beep", 0.7)
end

function Sfx.wind(_level: number) end

function Sfx.setMuted(on: boolean)
	Sfx.muted = on
end

function Sfx.setMusic(on: boolean)
	Sfx.musicOn = on
	if on and music.SoundId ~= "" then
		if not music.IsPlaying then
			music:Play()
		end
	else
		music:Stop()
	end
end

-- a little louder in the lobby than while riding
function Sfx.musicVolume(v: number)
	music.Volume = v
end

return Sfx
