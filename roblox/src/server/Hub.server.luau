--!strict
-- 해커온 광장: 스폰 자리, 노랑이 동상, 데모 무대.
-- 노랑이는 콘센트 머리(앰버)에 세로 눈 둘, 입은 그리지 않는다(브랜드 규칙).

local AMBER = Color3.fromRGB(255, 176, 32)
local INK = Color3.fromRGB(11, 16, 32)
local LIME = Color3.fromRGB(200, 245, 59)

local function part(name: string, size: Vector3, cf: CFrame, color: Color3, parent: Instance): Part
	local p = Instance.new("Part")
	p.Name = name
	p.Size = size
	p.CFrame = cf
	p.Color = color
	p.Anchored = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Parent = parent
	return p
end

local hub = Instance.new("Folder")
hub.Name = "HackonHub"
hub.Parent = workspace

-- 바닥과 스폰
part("Floor", Vector3.new(160, 1, 160), CFrame.new(0, 0, 0), Color3.fromRGB(238, 241, 244), hub)
local spawn = Instance.new("SpawnLocation")
spawn.Size = Vector3.new(8, 1, 8)
spawn.CFrame = CFrame.new(0, 1, 40)
spawn.Anchored = true
spawn.Color = LIME
spawn.Parent = hub

-- 노랑이 동상: 머리(콘센트) + 눈 둘 + 몸·팔·다리(연결선)
local statue = Instance.new("Model")
statue.Name = "Norangi"
statue.Parent = hub
local head = part("Head", Vector3.new(10, 9, 3), CFrame.new(0, 22, 0), AMBER, statue)
part("EyeL", Vector3.new(1.2, 3, 0.4), head.CFrame * CFrame.new(-1.8, 0.5, -1.6), INK, statue)
part("EyeR", Vector3.new(1.2, 3, 0.4), head.CFrame * CFrame.new(1.8, 0.5, -1.6), INK, statue)
part("Body", Vector3.new(1.5, 8, 1.5), CFrame.new(0, 13.5, 0), AMBER, statue)
part("ArmL", Vector3.new(6, 1.5, 1.5), CFrame.new(-3.5, 15, 0) * CFrame.Angles(0, 0, math.rad(-20)), AMBER, statue)
part("ArmR", Vector3.new(6, 1.5, 1.5), CFrame.new(3.5, 16.5, 0) * CFrame.Angles(0, 0, math.rad(40)), AMBER, statue)
part("LegL", Vector3.new(1.5, 7, 1.5), CFrame.new(-1.6, 6.5, 0) * CFrame.Angles(0, 0, math.rad(-15)), AMBER, statue)
part("LegR", Vector3.new(1.5, 7, 1.5), CFrame.new(1.6, 6.5, 0) * CFrame.Angles(0, 0, math.rad(15)), AMBER, statue)

-- 데모 무대: 팀당 2분 발표를 여기서. 큰 화면 자리에 «ON» 표시
local stage = part("Stage", Vector3.new(40, 2, 16), CFrame.new(0, 1.5, -50), INK, hub)
local screen = part("Screen", Vector3.new(30, 14, 1), CFrame.new(0, 10, -58), INK, hub)
local gui = Instance.new("SurfaceGui")
gui.Face = Enum.NormalId.Front
gui.Parent = screen
local label = Instance.new("TextLabel")
label.Size = UDim2.fromScale(1, 1)
label.BackgroundTransparency = 1
label.TextScaled = true
label.Font = Enum.Font.GothamBlack
label.TextColor3 = LIME
label.Text = "HACK:ON — 데모 무대"
label.Parent = gui
_ = stage
