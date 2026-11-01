import {View} from '@tarojs/components'
import REFFO_LOGO from '@/assets/branding/reffo-logo.png'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react'

const GestureMotionView = View as unknown as ComponentType<any>

export interface PhysicsBadgeProps {
  children: ReactNode
  strapColor?: string
  strapWidth?: number
  gravity?: number
  damping?: number
  elasticity?: number
  breeze?: number
  interactive?: boolean
  captureOnMount?: boolean
}

interface PhysicsSettings {
  strapColor: string
  strapWidth: number
  gravity: number
  damping: number
  elasticity: number
  breeze: number
}

interface LanyardPhysics {
  gravity: number
  hold: number
  stiffness: number
  spring: number
  bandDamping: number
  linearDrag: number
  angularDrag: number
  air: number
  broadside: number
  spinAir: number
  nodeDrag: number
  nodeAir: number
  twist: number
  twistDamping: number
  grip: number
  gripDamping: number
  breeze: number
}

interface InteractionEvent {
  button?: number
  pointerId?: number
  clientX?: number
  clientY?: number
  touches?: Array<{clientX: number, clientY: number}>
  changedTouches?: Array<{clientX: number, clientY: number}>
  stopPropagation?: () => void
  preventDefault?: () => void
}

interface BadgePose {
  x: number
  y: number
  rotation: number[]
}

interface DragApi {
  start: (x: number, y: number) => void
  move: (x: number, y: number) => void
  end: () => void
}

const STAGE_WIDTH = 320
const STAGE_HEIGHT = 520
const RENDER_WIDTH = 520
const WORLD_SCALE = 100
const WORLD_STAGE_WIDTH = STAGE_WIDTH / WORLD_SCALE
const WORLD_RENDER_WIDTH = RENDER_WIDTH / WORLD_SCALE
const WORLD_STAGE_HEIGHT = STAGE_HEIGHT / WORLD_SCALE
const ANCHOR_X = WORLD_STAGE_WIDTH / 2
const ANCHOR_Y = 0
const BASE_END_X = ANCHOR_X
const BASE_END_Y = 1.55
const CARD_WIDTH = 2.1
const CARD_HEIGHT = 3.32
const CARD_THICKNESS = 0.02
const STRAP_WIDTH = 0.34
const CLAMP_SIDE_CLEARANCE = 0.05
const CLAMP_WIDTH = STRAP_WIDTH + CLAMP_SIDE_CLEARANCE * 2
const CLAMP_BODY = 0.22
const CLAMP_CENTER_Y = 0
const BASE_ATTACH_Y = BASE_END_Y + CLAMP_CENTER_Y
const JOINTS = 4
const NODE_COUNT = JOINTS + 1
const ROPE_LENGTH = BASE_ATTACH_Y - ANCHOR_Y
const SEGMENT_LENGTH = ROPE_LENGTH / JOINTS
const MAX_STEP = 1 / 360
const ITERATIONS = 3
const SAMPLES = 72
const BAND_COLUMNS = [0, 0.07, 0.93, 1]
const BAND_BEND = [-0.95, -0.28, 0.28, 0.95]
const NODE_WEIGHT = 1 / 0.05
const RETURN_STIFFNESS = 30
const RETURN_DAMPING = 4.5
const RETURN_POSITION_STIFFNESS = 9
const RETURN_POSITION_DAMPING = 2.2
const RETURN_SETTLE_DURATION = 0.18
const RETURN_POSITION_EPSILON = 0.004
const RETURN_ROTATION_EPSILON = 0.0035
const MAX_DRAG_ANGLE = 0

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function mix(start: number, end: number, amount: number) {
  return start + (end - start) * amount
}

function getEventPoint(event: InteractionEvent) {
  const touch = event.touches?.[0] || event.changedTouches?.[0]
  return {
    x: touch?.clientX ?? event.clientX ?? 0,
    y: touch?.clientY ?? event.clientY ?? 0,
  }
}

function formatCoordinate(value: number) {
  return value.toFixed(2)
}

function seeded(seed: number) {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
}

export default function PhysicsBadge({
  children,
  strapColor = '#dff9ea',
  strapWidth = 1,
  gravity = 1.2,
  damping = 0.82,
  elasticity = 0.08,
  breeze = 0.08,
  interactive = true,
  captureOnMount = true,
}: PhysicsBadgeProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [isCapturing, setIsCapturing] = useState(captureOnMount)
  const [webglFailed, setWebglFailed] = useState(false)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const motionRef = useRef<HTMLDivElement | null>(null)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const dragApiRef = useRef<DragApi | null>(null)
  const activePointerIdRef = useRef<number | null>(null)
  const followsDomPoseRef = useRef(!interactive || isCapturing)
  followsDomPoseRef.current = !interactive || isCapturing
  const physicsSettingsRef = useRef<PhysicsSettings>({
    strapColor,
    strapWidth,
    gravity,
    damping,
    elasticity,
    breeze,
  })
  physicsSettingsRef.current = {strapColor, strapWidth, gravity, damping, elasticity, breeze}

  const applyPose = useCallback((pose: BadgePose) => {
    const motion = motionRef.current
    if (!motion) return
    const rotation = pose.rotation.map(value => value.toFixed(5)).join(',')
    motion.style.transform = `translateX(-50%) translate3d(${formatCoordinate(pose.x)}px, ${formatCoordinate(pose.y)}px, 0) matrix3d(${rotation})`
  }, [])

  const startDrag = useCallback((event: InteractionEvent) => {
    if (event.button != null && event.button !== 0) return
    if (event.pointerId != null && activePointerIdRef.current != null) return
    activePointerIdRef.current = event.pointerId ?? null
    const pointer = getEventPoint(event)
    dragApiRef.current?.start(pointer.x, pointer.y)
    setIsDragging(true)
    if (event.pointerId != null) {
      motionRef.current?.setPointerCapture?.(event.pointerId)
    }
    event.stopPropagation?.()
    event.preventDefault?.()
  }, [])

  const moveDrag = useCallback((event: InteractionEvent) => {
    if (event.pointerId != null && activePointerIdRef.current !== event.pointerId) return
    const pointer = getEventPoint(event)
    dragApiRef.current?.move(pointer.x, pointer.y)
    event.stopPropagation?.()
    event.preventDefault?.()
  }, [])

  const endDrag = useCallback((event?: InteractionEvent) => {
    if (
      event?.pointerId != null
      && activePointerIdRef.current != null
      && activePointerIdRef.current !== event.pointerId
    ) return
    const pointerId = activePointerIdRef.current
    activePointerIdRef.current = null
    if (pointerId != null && motionRef.current?.hasPointerCapture?.(pointerId)) {
      motionRef.current.releasePointerCapture(pointerId)
    }
    dragApiRef.current?.end()
    setIsDragging(false)
    event?.stopPropagation?.()
  }, [])

  useEffect(() => {
    if (!isCapturing) return
    const timer = window.setTimeout(() => setIsCapturing(false), 1040)
    return () => window.clearTimeout(timer)
  }, [isCapturing])

  useEffect(() => {
    const element = motionRef.current
    if (!element || !interactive) return

    const onPointerDown = (event: PointerEvent) => startDrag(event)
    const onPointerMove = (event: PointerEvent) => moveDrag(event)
    const onPointerUp = (event: PointerEvent) => endDrag(event)
    const onPointerLost = (event: PointerEvent) => endDrag(event)
    const onWindowBlur = () => endDrag()

    element.addEventListener('pointerdown', onPointerDown)
    element.addEventListener('lostpointercapture', onPointerLost)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    window.addEventListener('blur', onWindowBlur)

    return () => {
      element.removeEventListener('pointerdown', onPointerDown)
      element.removeEventListener('lostpointercapture', onPointerLost)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [endDrag, interactive, moveDrag, startDrag])

  useEffect(() => {
    let disposed = false
    let animationFrame = 0
    let visible = true
    let renderer: any
    let scene: any
    let camera: any
    let bandGeometry: any
    let bandMaterial: any
    let weaveTexture: any
    let strapTexture: any
    let lanyardClampGeometry: any
    let lanyardClampFaceGeometry: any
    let lanyardMetalMaterial: any
    let lanyardClampFaceMaterial: any
    let metalNormalTexture: any
    let environment: any
    let observer: any

    async function setup() {
      const canvas = canvasRef.current
      if (!canvas) return

      try {
        const THREE = await import('three')
        if (disposed) return

        const random = seeded(19)
        const weaveSize = 128
        const weaveThreads = 8
        const weaveData = new Uint8Array(weaveSize * weaveSize * 4)
        const weaveProfile = (value: number) => Math.sqrt(Math.max(0, 1 - 4 * value * value))
        const weaveHeight = (x: number, y: number) => {
          const px = ((x % weaveSize) + weaveSize) % weaveSize
          const py = ((y % weaveSize) + weaveSize) % weaveSize
          const u = (px / weaveSize) * weaveThreads
          const v = (py / weaveSize) * weaveThreads
          const cu = Math.floor(u)
          const cv = Math.floor(v)
          const fu = u - cu - 0.5
          const fv = v - cv - 0.5
          const lift = (cu + cv) % 2 === 0
          const warp = weaveProfile(fu) * (0.55 + 0.45 * Math.cos(fv * Math.PI * (lift ? 1 : 0.6)))
          const weft = weaveProfile(fv) * (0.55 + 0.45 * Math.cos(fu * Math.PI * (lift ? 0.6 : 1)))
          return (lift ? Math.max(warp, weft * 0.7) : Math.max(weft, warp * 0.7)) + random() * 0.08
        }
        for (let y = 0; y < weaveSize; y += 1) {
          for (let x = 0; x < weaveSize; x += 1) {
            const nx = (weaveHeight(x - 1, y) - weaveHeight(x + 1, y)) * 1.6
            const ny = (weaveHeight(x, y - 1) - weaveHeight(x, y + 1)) * 1.6
            const length = Math.hypot(nx, ny, 1)
            const index = (y * weaveSize + x) * 4
            weaveData[index] = ((nx / length) * 0.5 + 0.5) * 255
            weaveData[index + 1] = ((ny / length) * 0.5 + 0.5) * 255
            weaveData[index + 2] = ((1 / length) * 0.5 + 0.5) * 255
            weaveData[index + 3] = 255
          }
        }
        weaveTexture = new THREE.DataTexture(weaveData, weaveSize, weaveSize)
        weaveTexture.wrapS = THREE.RepeatWrapping
        weaveTexture.wrapT = THREE.RepeatWrapping
        weaveTexture.repeat.set(2, 8)
        weaveTexture.magFilter = THREE.LinearFilter
        weaveTexture.minFilter = THREE.LinearMipmapLinearFilter
        weaveTexture.generateMipmaps = true
        weaveTexture.needsUpdate = true

        renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: true,
          powerPreference: 'high-performance',
        })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
        renderer.setSize(RENDER_WIDTH, STAGE_HEIGHT, false)
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.toneMapping = THREE.NeutralToneMapping
        renderer.toneMappingExposure = 1

        scene = new THREE.Scene()
        camera = new THREE.OrthographicCamera(
          (WORLD_STAGE_WIDTH - WORLD_RENDER_WIDTH) / 2,
          (WORLD_STAGE_WIDTH + WORLD_RENDER_WIDTH) / 2,
          0,
          WORLD_STAGE_HEIGHT,
          -10,
          10,
        )
        camera.position.set(0, 0, 5)
        camera.lookAt(0, 0, 0)
        camera.updateProjectionMatrix()
        camera.updateMatrixWorld()

        const environmentScene = new THREE.Scene()
        environmentScene.background = new THREE.Color(0.035, 0.035, 0.04)
        const environmentGeometry = new THREE.PlaneGeometry(1, 1)
        const environmentPanels: any[] = []
        const addPanel = (intensity: number, position: [number, number, number], scale: [number, number], rotation = 0) => {
          const material = new THREE.MeshBasicMaterial({
            color: new THREE.Color(intensity, intensity, intensity),
            side: THREE.DoubleSide,
          })
          const panel = new THREE.Mesh(environmentGeometry, material)
          panel.position.set(...position)
          panel.scale.set(scale[0], scale[1], 1)
          panel.lookAt(0, 0, 0)
          panel.rotateZ(rotation)
          environmentScene.add(panel)
          environmentPanels.push(material)
        }
        addPanel(2.6, [0, 4.5, 8], [9, 4])
        addPanel(6, [-5.5, 0.5, 7], [0.9, 14])
        addPanel(4, [5, -0.5, 8], [0.6, 14])
        addPanel(3.5, [0, -1, 9], [24, 0.35], Math.PI / 3)
        addPanel(2.5, [1, 2.5, 9], [24, 0.2], Math.PI / 3)
        addPanel(1.4, [0, 6, -6], [12, 4])
        addPanel(0.5, [0, -7, 1], [16, 6])
        addPanel(0.9, [8, 0, -2], [4, 10])
        const pmrem = new THREE.PMREMGenerator(renderer)
        const environmentTarget = pmrem.fromScene(environmentScene, 0.035)
        environment = environmentTarget
        scene.environment = environmentTarget.texture
        pmrem.dispose()
        environmentGeometry.dispose()
        environmentPanels.forEach(material => material.dispose())

        const keyLight = new THREE.DirectionalLight(0xffffff, 1.6)
        keyLight.position.set(-2.5, 4, 6)
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.35)
        fillLight.position.set(3, -1, 4)
        scene.add(keyLight, fillLight)

        const roundedRectShape = (width: number, height: number, radius: number) => {
          const shape = new THREE.Shape()
          const x = -width / 2
          const y = -height / 2
          const r = Math.min(radius, width / 2, height / 2)
          shape.moveTo(x + r, y)
          shape.lineTo(x + width - r, y)
          shape.quadraticCurveTo(x + width, y, x + width, y + r)
          shape.lineTo(x + width, y + height - r)
          shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
          shape.lineTo(x + r, y + height)
          shape.quadraticCurveTo(x, y + height, x, y + height - r)
          shape.lineTo(x, y + r)
          shape.quadraticCurveTo(x, y, x + r, y)
          return shape
        }

        const buildBandGeometry = (count: number) => {
          const columns = BAND_COLUMNS.length
          const geometry = new THREE.BufferGeometry()
          geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * columns * 3), 3))
          geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * columns * 3), 3))
          geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * columns * 2), 2))
          const indices: number[] = []
          for (let i = 0; i < count - 1; i += 1) {
            for (let c = 0; c < columns - 1; c += 1) {
              const a = i * columns + c
              indices.push(a, a + columns, a + 1, a + 1, a + columns, a + columns + 1)
            }
          }
          geometry.setIndex(indices)
          return geometry
        }

        bandGeometry = buildBandGeometry(SAMPLES)
        const strapCanvas = document.createElement('canvas')
        strapCanvas.width = 192
        strapCanvas.height = 384
        const strapContext = strapCanvas.getContext('2d')
        strapTexture = new THREE.CanvasTexture(strapCanvas)
        strapTexture.colorSpace = THREE.SRGBColorSpace
        strapTexture.wrapS = THREE.ClampToEdgeWrapping
        strapTexture.wrapT = THREE.RepeatWrapping
        strapTexture.repeat.set(1, 1)
        const logoImage = await new Promise<HTMLImageElement | null>(resolve => {
          const image = new Image()
          image.onload = () => resolve(image)
          image.onerror = () => resolve(null)
          image.src = REFFO_LOGO
        })
        const paintStrap = () => {
          if (!strapContext) return
          const {width, height} = strapCanvas
          strapContext.clearRect(0, 0, width, height)
          strapContext.fillStyle = physicsSettingsRef.current.strapColor
          strapContext.fillRect(0, 0, width, height)
          strapContext.fillStyle = 'rgba(255, 255, 255, 0.18)'
          for (let y = 2; y < height; y += 4) strapContext.fillRect(0, y, width, 1)
          strapContext.fillStyle = 'rgba(35, 61, 51, 0.08)'
          for (let y = 12; y < height; y += 14) {
            strapContext.fillRect(width * 0.075, y, 2, 8)
            strapContext.fillRect(width * 0.925 - 2, y, 2, 8)
          }
          if (logoImage) {
            const logoHeight = 100
            const logoWidth = logoHeight * (logoImage.naturalWidth / logoImage.naturalHeight)
            strapContext.save()
            strapContext.translate(width / 2, height / 2)
            strapContext.rotate(-Math.PI / 2)
            strapContext.globalAlpha = 0.92
            strapContext.drawImage(logoImage, -logoWidth / 2, -logoHeight / 2, logoWidth, logoHeight)
            strapContext.restore()
          }
          strapTexture.needsUpdate = true
        }
        paintStrap()
        bandMaterial = new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          map: strapTexture,
          emissive: new THREE.Color(0xffffff),
          emissiveMap: strapTexture,
          emissiveIntensity: 0.62,
          normalMap: weaveTexture,
          normalScale: new THREE.Vector2(0.92, 0.92),
          roughness: 0.72,
          sheen: 0.9,
          sheenRoughness: 0.52,
          sheenColor: new THREE.Color(physicsSettingsRef.current.strapColor).lerp(new THREE.Color(1, 1, 1), 0.32),
          side: THREE.DoubleSide,
        })
        const band = new THREE.Mesh(bandGeometry, bandMaterial)
        band.frustumCulled = false
        band.renderOrder = 1
        scene.add(band)

        const buildLanyardClampGeometry = (width: number) => {
          const shapeWidth = width * 1.16 - 0.028
          const shapeHeight = CLAMP_BODY - 0.028
          const outline = roundedRectShape(shapeWidth, shapeHeight, 0.024)
          const body = new THREE.ExtrudeGeometry(
            outline,
            {
              depth: 0.02,
              bevelEnabled: true,
              bevelThickness: 0.014,
              bevelSize: 0.014,
              bevelSegments: 6,
              curveSegments: 10,
            },
          )
          body.translate(0, 0, -0.01)

          const face = new THREE.ShapeGeometry(outline, 10)
          const position = face.getAttribute('position')
          const uv = face.getAttribute('uv')
          for (let index = 0; index < position.count; index += 1) {
            uv.setXY(
              index,
              (position.getX(index) + shapeWidth / 2) / shapeWidth,
              (position.getY(index) + shapeHeight / 2) / shapeHeight,
            )
          }
          uv.needsUpdate = true
          return {body, face}
        }

        const metalNormalCanvas = document.createElement('canvas')
        metalNormalCanvas.width = 128
        metalNormalCanvas.height = 64
        const metalNormalContext = metalNormalCanvas.getContext('2d')
        if (metalNormalContext) {
          const normalImage = metalNormalContext.createImageData(
            metalNormalCanvas.width,
            metalNormalCanvas.height,
          )
          for (let y = 0; y < metalNormalCanvas.height; y += 1) {
            for (let x = 0; x < metalNormalCanvas.width; x += 1) {
              const nx = ((x / (metalNormalCanvas.width - 1)) * 2 - 1) * 0.72
              const ny = ((y / (metalNormalCanvas.height - 1)) * 2 - 1) * 0.08
              const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
              const offset = (y * metalNormalCanvas.width + x) * 4
              normalImage.data[offset] = Math.round((nx * 0.5 + 0.5) * 255)
              normalImage.data[offset + 1] = Math.round((ny * 0.5 + 0.5) * 255)
              normalImage.data[offset + 2] = Math.round((nz * 0.5 + 0.5) * 255)
              normalImage.data[offset + 3] = 255
            }
          }
          metalNormalContext.putImageData(normalImage, 0, 0)
        }
        metalNormalTexture = new THREE.CanvasTexture(metalNormalCanvas)
        metalNormalTexture.colorSpace = THREE.NoColorSpace

        lanyardMetalMaterial = new THREE.MeshStandardMaterial({
          color: '#e8ecef',
          metalness: 1,
          roughness: 0.1,
          envMapIntensity: 2.1,
          depthTest: false,
        })
        const clampGroup = new THREE.Group()
        const clampGeometry = buildLanyardClampGeometry(CLAMP_WIDTH / 1.16)
        lanyardClampGeometry = clampGeometry.body
        const clampMesh = new THREE.Mesh(clampGeometry.body, lanyardMetalMaterial)
        lanyardClampFaceGeometry = clampGeometry.face
        lanyardClampFaceMaterial = lanyardMetalMaterial.clone()
        lanyardClampFaceMaterial.normalMap = metalNormalTexture
        lanyardClampFaceMaterial.normalScale = new THREE.Vector2(0.58, 0.12)
        const clampFace = new THREE.Mesh(lanyardClampFaceGeometry, lanyardClampFaceMaterial)
        clampMesh.position.z = 0.035
        clampFace.position.z = 0.055
        clampMesh.renderOrder = 30
        clampFace.renderOrder = 31
        clampGroup.renderOrder = 10
        clampGroup.add(clampMesh, clampFace)
        scene.add(clampGroup)

        const vectors = () => Array.from({length: NODE_COUNT}, () => new THREE.Vector3())
        const sim: any = {
          nodes: vectors(),
          previous: vectors(),
          velocities: vectors(),
          lengths: new Float64Array(JOINTS),
          impulses: new Float64Array(JOINTS),
          rest: SEGMENT_LENGTH,
          anchor: new THREE.Vector3(ANCHOR_X, ANCHOR_Y, 0),
          body: {
            position: new THREE.Vector3(BASE_END_X, BASE_END_Y, 0),
            previous: new THREE.Vector3(BASE_END_X, BASE_END_Y, 0),
            velocity: new THREE.Vector3(),
            quaternion: new THREE.Quaternion(),
            previousQuaternion: new THREE.Quaternion(),
            angular: new THREE.Vector3(),
            mass: 1,
            inverseInertia: new THREE.Vector3(),
            hang: new THREE.Vector3(0, CLAMP_CENTER_Y, 0),
          },
          grab: null,
          returning: false,
          turn: 0,
          twist: 0,
          twistRaw: 0,
          calm: 0,
        }
        sim.body.inverseInertia.set(
          12 / (CARD_HEIGHT * CARD_HEIGHT + CARD_THICKNESS * CARD_THICKNESS),
          12 / (CARD_WIDTH * CARD_WIDTH + CARD_THICKNESS * CARD_THICKNESS),
          12 / (CARD_WIDTH * CARD_WIDTH + CARD_HEIGHT * CARD_HEIGHT),
        )

        const scratch: any = {
          a: new THREE.Vector3(),
          b: new THREE.Vector3(),
          c: new THREE.Vector3(),
          d: new THREE.Vector3(),
          e: new THREE.Vector3(),
          f: new THREE.Vector3(),
          g: new THREE.Vector3(),
          pin: new THREE.Vector3(),
          q: new THREE.Quaternion(),
          r: new THREE.Quaternion(),
        }

        const applyInverseInertia = (body: any, vector: any, out: any) => {
          scratch.r.copy(body.quaternion).invert()
          out.copy(vector).applyQuaternion(scratch.r)
          out.set(out.x * body.inverseInertia.x, out.y * body.inverseInertia.y, out.z * body.inverseInertia.z)
          return out.applyQuaternion(body.quaternion)
        }

        const rotateBody = (quaternion: any, angular: any) => {
          const {x, y, z, w} = quaternion
          quaternion.x += 0.5 * (angular.x * w + angular.y * z - angular.z * y)
          quaternion.y += 0.5 * (angular.y * w + angular.z * x - angular.x * z)
          quaternion.z += 0.5 * (angular.z * w + angular.x * y - angular.y * x)
          quaternion.w += 0.5 * (-angular.x * x - angular.y * y - angular.z * z)
          quaternion.normalize()
        }

        const bodyWeight = (body: any, offset: any, normal: any) => {
          const cross = scratch.c.crossVectors(offset, normal)
          return 1 / body.mass + cross.dot(applyInverseInertia(body, cross, scratch.d))
        }

        const pushBody = (body: any, offset: any, impulse: any) => {
          body.position.addScaledVector(impulse, 1 / body.mass)
          rotateBody(body.quaternion, applyInverseInertia(body, scratch.e.crossVectors(offset, impulse), scratch.f))
        }

        const resolvePhysics = (): LanyardPhysics => {
          const settings = physicsSettingsRef.current
          const gravityForce = 48 * clamp(settings.gravity, 0, 3)
          const weight = Math.max(gravityForce, 24)
          const springy = clamp(settings.elasticity, 0, 1)
          const settle = clamp(settings.damping, 0, 1)
          const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
          return {
            gravity: gravityForce,
            hold: weight * mix(2.2, 5.5, springy),
            stiffness: weight * 10 * JOINTS,
            spring: weight * mix(0.1, 0.4, springy) * JOINTS,
            bandDamping: weight * mix(0.3, 0.08, springy) * JOINTS,
            linearDrag: 0.25 * Math.pow(16, settle),
            angularDrag: 0.5 * Math.pow(12, settle),
            air: 0.15,
            broadside: 0.5,
            spinAir: 0.03,
            nodeDrag: 2,
            nodeAir: 0.2,
            twist: 30,
            twistDamping: 3,
            grip: 40,
            gripDamping: 6,
            breeze: reducedMotion ? 0 : clamp(settings.breeze, 0, 1),
          }
        }

        const solveSegment = (index: number, step: number, physics: LanyardPhysics) => {
          const current = sim.nodes[index]
          const next = sim.nodes[index + 1]
          const offset = scratch.g
          let nextPoint = next
          const last = index === JOINTS - 1
          if (last) {
            offset.copy(sim.body.hang).applyQuaternion(sim.body.quaternion)
            nextPoint = scratch.b.copy(sim.body.position).add(offset)
          }
          const delta = scratch.a.subVectors(nextPoint, current)
          const distance = delta.length()
          const stretch = distance - sim.rest
          if (stretch <= 0 || distance < 1e-9) return
          const normal = delta.divideScalar(distance)
          const weightA = index === 0 ? 0 : NODE_WEIGHT
          const weightB = last ? bodyWeight(sim.body, offset, normal) : NODE_WEIGHT
          const rate = (distance - sim.lengths[index]) / step
          const tension = physics.hold * Math.tanh((physics.stiffness * stretch) / physics.hold)
            + physics.spring * stretch
            + physics.bandDamping * Math.max(0, rate)
          const room = tension * step * step - sim.impulses[index]
          if (room <= 0) return
          const lambda = Math.min(stretch / (weightA + weightB), room)
          sim.impulses[index] += lambda
          if (weightA) current.addScaledVector(normal, lambda * weightA)
          if (last) pushBody(sim.body, offset, normal.multiplyScalar(-lambda))
          else nextPoint.addScaledVector(normal, -lambda * weightB)
        }

        const solvePin = (target: any) => {
          const offset = scratch.g.copy(sim.grab.local).applyQuaternion(sim.body.quaternion)
          const delta = scratch.a.copy(target).sub(sim.body.position).sub(offset)
          const distance = delta.length()
          if (distance < 1e-9) return
          const normal = delta.divideScalar(distance)
          const lambda = distance / bodyWeight(sim.body, offset, normal)
          pushBody(sim.body, offset, normal.multiplyScalar(lambda))
        }

        const placeHanging = () => {
          sim.nodes[0].copy(sim.anchor)
          for (let index = 1; index <= JOINTS; index += 1) {
            sim.nodes[index].copy(sim.nodes[index - 1])
            sim.nodes[index].y += sim.rest
          }
          sim.body.position.set(BASE_END_X, BASE_END_Y, 0)
          sim.body.previous.copy(sim.body.position)
          sim.body.previousQuaternion.copy(sim.body.quaternion)
          sim.body.velocity.set(0, 0, 0)
          sim.body.angular.set(0, 0, 0)
          sim.body.quaternion.identity()
          sim.body.previousQuaternion.copy(sim.body.quaternion)
          sim.nodes[JOINTS].copy(sim.body.hang).applyQuaternion(sim.body.quaternion).add(sim.body.position)
          for (let index = 0; index <= JOINTS; index += 1) {
            sim.previous[index].copy(sim.nodes[index])
            sim.velocities[index].set(0, 0, 0)
          }
          sim.lengths.fill(sim.rest)
          sim.impulses.fill(0)
          sim.twist = 0
          sim.twistRaw = 0
          sim.calm = 0
          sim.returning = false
        }

        const stepSimulation = (delta: number, time: number) => {
          const physics = resolvePhysics()
          const steps = Math.max(1, Math.ceil(delta / MAX_STEP - 1e-6))
          const step = delta / steps
          const windX = physics.breeze * (Math.sin(time * 0.53) * 0.7 + Math.sin(time * 1.31 + 1.7) * 0.3) * 3
          const windZ = physics.breeze * Math.sin(time * 0.37 + 0.6) * 2
          const nodeDrag = Math.exp(-physics.nodeDrag * step)
          const linearDrag = Math.exp(-physics.linearDrag * step)
          const angularDrag = Math.exp(-physics.angularDrag * step)

          for (let substep = 0; substep < steps; substep += 1) {
            for (let index = 1; index < JOINTS; index += 1) {
              const velocity = sim.velocities[index]
              velocity.y += physics.gravity * step
              velocity.x += windX * step
              velocity.z += windZ * step
              sim.previous[index].copy(sim.nodes[index])
              sim.nodes[index].addScaledVector(velocity, step)
            }

            sim.body.previous.copy(sim.body.position)
            sim.body.previousQuaternion.copy(sim.body.quaternion)
            const bodyQuaternion = sim.body.quaternion
            if (sim.grab) {
              const turn = scratch.q.copy(sim.grab.rotation).multiply(scratch.r.copy(bodyQuaternion).invert())
              if (turn.w < 0) turn.set(-turn.x, -turn.y, -turn.z, -turn.w)
              const torque = scratch.a.set(turn.x, turn.y, turn.z).multiplyScalar(2 * physics.grip)
              torque.addScaledVector(sim.body.angular, -physics.gripDamping)
              sim.body.angular.addScaledVector(applyInverseInertia(sim.body, torque, scratch.b), step)
            }

            const up = scratch.a.set(0, 1, 0).applyQuaternion(bodyQuaternion)
            const front = scratch.b.set(-up.x * up.z, -up.y * up.z, 1 - up.z * up.z)
            if (front.lengthSq() > 1e-3) {
              const facing = scratch.d.set(0, 0, 1).applyQuaternion(bodyQuaternion)
              const raw = Math.atan2(scratch.e.crossVectors(front, facing).dot(up), front.dot(facing))
              let turned = raw - sim.twistRaw
              if (turned > Math.PI) turned -= Math.PI * 2
              else if (turned < -Math.PI) turned += Math.PI * 2
              sim.twist += turned
              sim.twistRaw = raw
            }
            if (!sim.grab) {
              const turn = scratch.q.identity().multiply(scratch.r.copy(bodyQuaternion).invert())
              if (turn.w < 0) turn.set(-turn.x, -turn.y, -turn.z, -turn.w)
              const torque = scratch.a.set(turn.x, turn.y, turn.z).multiplyScalar(2 * RETURN_STIFFNESS)
              torque.addScaledVector(sim.body.angular, -RETURN_DAMPING)
              sim.body.angular.addScaledVector(applyInverseInertia(sim.body, torque, scratch.b), step)
              const restOffset = scratch.g.set(
                BASE_END_X - sim.body.position.x,
                BASE_END_Y - sim.body.position.y,
                -sim.body.position.z,
              )
              sim.body.velocity.addScaledVector(restOffset, RETURN_POSITION_STIFFNESS * step)
              sim.body.velocity.addScaledVector(sim.body.velocity, -RETURN_POSITION_DAMPING * step)
            }

            sim.body.velocity.y += physics.gravity * step
            sim.body.velocity.x += windX * 0.35 * step
            sim.body.velocity.z += windZ * 0.35 * step
            sim.body.position.addScaledVector(sim.body.velocity, step)
            rotateBody(sim.body.quaternion, scratch.f.copy(sim.body.angular).multiplyScalar(step))

            sim.impulses.fill(0)
            const pin = scratch.pin
            if (sim.grab) pin.lerpVectors(sim.grab.from, sim.grab.target, (substep + 1) / steps)
            for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
              for (let index = 0; index < JOINTS; index += 1) solveSegment(index, step, physics)
              if (sim.grab) solvePin(pin)
            }

            if (sim.grab) {
              sim.body.quaternion.identity()
              sim.body.previousQuaternion.identity()
              sim.body.angular.set(0, 0, 0)
            }

            for (let index = 1; index < JOINTS; index += 1) {
              const velocity = sim.velocities[index].subVectors(sim.nodes[index], sim.previous[index]).divideScalar(step).multiplyScalar(nodeDrag)
              velocity.multiplyScalar(1 / (1 + physics.nodeAir * velocity.length() * step))
            }
            sim.body.velocity.subVectors(sim.body.position, sim.body.previous).divideScalar(step)
            const deltaQuaternion = scratch.q.copy(sim.body.previousQuaternion).invert().premultiply(sim.body.quaternion)
            sim.body.angular.set(deltaQuaternion.x, deltaQuaternion.y, deltaQuaternion.z).multiplyScalar((2 / step) * (deltaQuaternion.w < 0 ? -1 : 1))

            const normal = scratch.a.set(0, 0, 1).applyQuaternion(sim.body.quaternion)
            const across = sim.body.velocity.dot(normal)
            const along = scratch.b.copy(sim.body.velocity).addScaledVector(normal, -across)
            along.multiplyScalar(1 / (1 + physics.air * along.length() * step))
            sim.body.velocity
              .copy(along)
              .addScaledVector(normal, across / (1 + physics.broadside * Math.abs(across) * step))
              .multiplyScalar(linearDrag)
            sim.body.angular.multiplyScalar(angularDrag / (1 + physics.spinAir * sim.body.angular.length() * step))
            sim.nodes[JOINTS].copy(sim.body.hang).applyQuaternion(sim.body.quaternion).add(sim.body.position)
            for (let index = 0; index < JOINTS; index += 1) sim.lengths[index] = sim.nodes[index].distanceTo(sim.nodes[index + 1])
          }

          if (sim.grab) sim.grab.from.copy(sim.grab.target)
          let energy = sim.body.velocity.lengthSq() + sim.body.angular.lengthSq() * 0.3
          for (let index = 1; index < JOINTS; index += 1) energy += sim.velocities[index].lengthSq() * 0.05
          const restDistance = sim.body.position.distanceTo(scratch.b.set(BASE_END_X, BASE_END_Y, 0))
          const rotationError = 2 * Math.acos(clamp(Math.abs(sim.body.quaternion.w), 0, 1))
          const settled = energy < 2e-3
            && restDistance < RETURN_POSITION_EPSILON
            && rotationError < RETURN_ROTATION_EPSILON
          sim.calm = settled ? sim.calm + delta : 0
        }

        const points = Array.from({length: SAMPLES}, () => new THREE.Vector3())
        const sides = Array.from({length: SAMPLES}, () => new THREE.Vector3())
        const bends = BAND_BEND.map(angle => [Math.cos(angle), Math.sin(angle)] as [number, number])
        const controls: any[] = []
        const curve = new THREE.CatmullRomCurve3(controls, false, 'centripetal')
        const mouth = new THREE.Vector3()
        const tuck = new THREE.Vector3()
        const work: any = {
          tangent: new THREE.Vector3(),
          toCamera: new THREE.Vector3(),
          up: new THREE.Vector3(),
          body: new THREE.Vector3(),
          attach: new THREE.Vector3(),
          across: new THREE.Vector3(),
          facing: new THREE.Vector3(),
          end: new THREE.Vector3(),
        }

        const updateBand = () => {
          const anchorElement = anchorRef.current
          if (anchorElement && followsDomPoseRef.current) {
            const anchorRect = anchorElement.getBoundingClientRect()
            work.body.copy(pointToWorld(
              anchorRect.left + anchorRect.width / 2,
              anchorRect.top + anchorRect.height / 2,
            ))
          } else {
            work.body.copy(sim.body.position)
          }
          const hang = work.attach.copy(sim.body.hang).applyQuaternion(sim.body.quaternion).add(work.body)
          const strapScale = STRAP_WIDTH * clamp(physicsSettingsRef.current.strapWidth, 0.4, 1.8)
          const reach = CLAMP_BODY * 0.72
          let guide = JOINTS - 1
          while (guide > 0 && sim.nodes[guide].distanceTo(hang) < reach * 1.1) guide -= 1
          const axis = work.up.subVectors(sim.nodes[guide], hang)
          if (axis.lengthSq() < 1e-8) axis.set(0, -1, 0).applyQuaternion(sim.body.quaternion)
          axis.normalize()
          mouth.copy(hang).addScaledVector(axis, reach)
          tuck.copy(hang).addScaledVector(axis, reach * 0.32)
          controls.length = 0
          for (let index = 0; index <= guide; index += 1) controls.push(sim.nodes[index])
          controls.push(mouth, tuck)
          curve.updateArcLengths()
          for (let index = 0; index < SAMPLES; index += 1) curve.getPointAt(index / (SAMPLES - 1), points[index])
          const curveLength = curve.getLength()
          const held = Math.max(0.25, 1 - mouth.distanceTo(tuck) / Math.max(curveLength, 0.001))
          const position = bandGeometry.getAttribute('position')
          const normal = bandGeometry.getAttribute('normal')
          const uv = bandGeometry.getAttribute('uv')
          const columns = BAND_COLUMNS.length
          const restLength = sim.rest * JOINTS
          const repeats = restLength / (strapScale * 2)
          const width = strapScale / Math.pow(Math.max(1, curveLength / restLength), 0.35)
          for (let index = 0; index < SAMPLES; index += 1) {
            work.tangent.subVectors(points[Math.min(SAMPLES - 1, index + 1)], points[Math.max(0, index - 1)])
            if (work.tangent.lengthSq() < 1e-12) work.tangent.set(0, -1, 0)
            work.tangent.normalize()
            work.toCamera.subVectors(camera.position, points[index]).normalize()
            const side = sides[index].crossVectors(work.toCamera, work.tangent)
            if (side.lengthSq() < 1e-10) side.copy(index > 0 ? sides[index - 1] : scratch.a.set(1, 0, 0))
            side.normalize()
            if (index > 0 && side.dot(sides[index - 1]) < 0) side.negate()
            const angle = -sim.twist * Math.pow(Math.min(1, index / (SAMPLES - 1) / held), 1.3)
            work.facing.crossVectors(work.tangent, side)
            work.across.copy(side).multiplyScalar(Math.cos(angle)).addScaledVector(work.facing, Math.sin(angle))
            work.facing.crossVectors(work.tangent, work.across)
            const point = points[index]
            const v = (1 - index / (SAMPLES - 1)) * repeats
            for (let column = 0; column < columns; column += 1) {
              const vertex = index * columns + column
              const offset = (BAND_COLUMNS[column] - 0.5) * width
              const [bendCos, bendSin] = bends[column]
              position.setXYZ(vertex, point.x + work.across.x * offset, point.y + work.across.y * offset, point.z + work.across.z * offset)
              normal.setXYZ(
                vertex,
                work.facing.x * bendCos + work.across.x * bendSin,
                work.facing.y * bendCos + work.across.y * bendSin,
                work.facing.z * bendCos + work.across.z * bendSin,
              )
              uv.setXY(vertex, BAND_COLUMNS[column], v)
            }
          }
          work.end.copy(work.across)
          position.needsUpdate = true
          normal.needsUpdate = true
          uv.needsUpdate = true
          clampGroup.quaternion.copy(sim.body.quaternion)
          clampGroup.position.copy(hang)
        }

        const emitPose = () => {
          if (followsDomPoseRef.current) return
          const rotationMatrix = new THREE.Matrix4().makeRotationFromQuaternion(sim.body.quaternion)
          applyPose({
            x: (sim.body.position.x - BASE_END_X) * WORLD_SCALE,
            y: (sim.body.position.y - BASE_END_Y) * WORLD_SCALE,
            rotation: Array.from(rotationMatrix.elements),
          })
        }

        const render = () => {
          emitPose()
          updateBand()
          renderer.render(scene, camera)
        }

        const raycaster = new THREE.Raycaster()
        const dragStart = {x: 0, y: 0, rotation: new THREE.Quaternion()}
        const pointToWorld = (clientX: number, clientY: number) => {
          const rect = canvas.getBoundingClientRect()
          const ndc = new THREE.Vector2(
            ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
            -(((clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1),
          )
          raycaster.setFromCamera(ndc, camera)
          return raycaster.ray.at(camera.position.z, new THREE.Vector3())
        }
        dragApiRef.current = {
          start: (clientX, clientY) => {
            const target = pointToWorld(clientX, clientY)
            sim.calm = 0
            sim.returning = false
            dragStart.x = clientX
            dragStart.y = clientY
            dragStart.rotation.copy(sim.body.quaternion)
            sim.grab = {
              local: target.clone().sub(sim.body.position).applyQuaternion(sim.body.quaternion.clone().invert()),
              rotation: sim.body.quaternion.clone(),
              reach: camera.position.z,
              from: target.clone(),
              target: target.clone(),
            }
            start()
          },
          move: (clientX, clientY) => {
            if (!sim.grab) return
            sim.calm = 0
            sim.grab.target.copy(pointToWorld(clientX, clientY))
            const dx = clientX - dragStart.x
            const desired = clamp(dx * 0.0031, -MAX_DRAG_ANGLE * Math.PI / 180, MAX_DRAG_ANGLE * Math.PI / 180)
            sim.grab.rotation.setFromAxisAngle(new THREE.Vector3(0, 0, 1), desired)
            start()
          },
          end: () => {
            sim.grab = null
            sim.calm = 0
            sim.returning = true
            start()
          },
        }

        const start = () => {
          if (!visible || animationFrame) return
          animationFrame = requestAnimationFrame(tick)
        }

        const tick = (now: number) => {
          animationFrame = 0
          if (!alive) return
          const delta = clamp((now - lastTime) / 1000, 1 / 240, 1 / 30)
          lastTime = now
          time += delta
          if (sim.grab || sim.returning || sim.calm < RETURN_SETTLE_DURATION) {
            stepSimulation(delta, time)
          } else if (!sim.grab && sim.returning) {
            placeHanging()
            sim.returning = false
            sim.calm = 1
          }
          render()
          if (visible) animationFrame = requestAnimationFrame(tick)
        }

        let alive = true
        let lastTime = performance.now()
        let time = 0
        placeHanging()
        render()

        observer = 'IntersectionObserver' in window
          ? new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting
            if (visible) start()
          })
          : null
        if (observer) observer.observe(stageRef.current || canvas)
        start()
      } catch (error) {
        console.warn('[Share PhysicsBadge] Three.js lanyard unavailable:', error)
        if (!disposed) setWebglFailed(true)
      }
    }

    setup()

    return () => {
      disposed = true
      dragApiRef.current = null
      if (animationFrame) cancelAnimationFrame(animationFrame)
      observer?.disconnect()
      bandGeometry?.dispose?.()
      bandMaterial?.dispose?.()
      weaveTexture?.dispose?.()
      strapTexture?.dispose?.()
      lanyardClampGeometry?.dispose?.()
      lanyardClampFaceGeometry?.dispose?.()
      lanyardMetalMaterial?.dispose?.()
      lanyardClampFaceMaterial?.dispose?.()
      metalNormalTexture?.dispose?.()
      environment?.dispose?.()
      renderer?.dispose?.()
    }
  }, [applyPose, strapColor, strapWidth])

  return (
    <View
      ref={stageRef}
      className={`share-physics ${isDragging ? 'share-physics--dragging' : ''} ${isCapturing ? 'share-physics--capturing' : ''} ${interactive ? '' : 'share-physics--static'}`}
    >
      <canvas
        ref={canvasRef}
        className='share-physics__lanyard-canvas'
        data-share-transition-role={webglFailed ? undefined : 'lanyard'}
        aria-hidden='true'
      />
      {webglFailed ? (
        <View className='share-physics__fallback-connector' data-share-transition-role='lanyard' aria-hidden='true'>
          <View className='share-physics__fallback-clip' />
        </View>
      ) : null}
      <GestureMotionView
        ref={motionRef}
        className='share-physics__motion'
        role={interactive ? 'button' : undefined}
        aria-label={interactive ? '拖动工卡查看物理效果' : undefined}
      >
        <View className='share-physics__capture'>
          <View ref={anchorRef} className='share-physics__clamp-anchor' aria-hidden='true' />
          <View className='share-physics__badge'>
            {children}
          </View>
        </View>
      </GestureMotionView>
    </View>
  )
}
