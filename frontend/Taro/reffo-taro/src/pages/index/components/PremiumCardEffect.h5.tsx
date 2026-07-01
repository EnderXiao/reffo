import {useEffect, useRef} from 'react'

interface PremiumCardEffectProps {
  tone: 'light' | 'dark'
  accentColor: string
  surfaceColor: string
}

export default function PremiumCardEffect({tone, accentColor, surfaceColor}: PremiumCardEffectProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let disposed = false
    let animationFrame = 0
    let renderer: any
    let scene: any
    let camera: any
    let material: any

    async function start() {
      const canvas = canvasRef.current

      if (!canvas) {
        return
      }

      try {
        const THREE = await import('three')

        if (disposed) {
          return
        }

        renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: true,
          powerPreference: 'high-performance',
        })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))

        scene = new THREE.Scene()
        camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
        material = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          uniforms: {
            uTime: {value: 0},
            uAccent: {value: new THREE.Color(accentColor || '#1b76f2')},
            uSurface: {value: new THREE.Color(surfaceColor || '#f0f6ff')},
            uDark: {value: tone === 'dark' ? 1 : 0},
          },
          vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0.0, 1.0);
          }
        `,
          fragmentShader: `
          precision mediump float;
          varying vec2 vUv;
          uniform float uTime;
          uniform vec3 uAccent;
          uniform vec3 uSurface;
          uniform float uDark;

          float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
          }

          vec3 cardBackground(vec2 uv) {
            float topGlow = 1.0 - smoothstep(0.14, 0.42, distance(uv, vec2(0.74, 1.02)));
            float leftPanel = 1.0 - smoothstep(0.18, 0.42, distance(uv, vec2(0.23, 0.52)));
            float lowerWarm = 1.0 - smoothstep(0.22, 0.58, distance(uv, vec2(0.90, 0.36)));
            float diagonal = smoothstep(-0.18, 0.88, uv.x * 0.72 + uv.y * 0.42);
            vec3 paper = mix(uSurface, vec3(1.0), 0.18);
            vec3 milk = mix(uSurface, vec3(1.0), 0.68);
            vec3 accentSoft = mix(uSurface, uAccent, 0.26);
            vec3 accentPale = mix(vec3(1.0), uAccent, 0.10);
            vec3 color = mix(paper, milk, diagonal * 0.72);
            color = mix(color, vec3(1.0), topGlow * 0.42);
            color = mix(color, accentSoft, lowerWarm * 0.28);
            color = mix(color, accentPale, leftPanel * 0.12);

            if (uDark > 0.5) {
              vec3 base = vec3(0.055, 0.060, 0.070);
              vec3 glow = mix(vec3(0.18, 0.19, 0.22), uAccent, 0.18);
              color = mix(base, glow, topGlow * 0.36 + lowerWarm * 0.30 + leftPanel * 0.12);
            }

            return color;
          }

          void main() {
            float grain = hash(floor((vUv + uTime * 0.0005) * vec2(180.0, 260.0))) - 0.5;
            vec3 base = cardBackground(vUv);
            vec3 color = mix(base, uDark > 0.5 ? vec3(0.10, 0.11, 0.13) : vec3(1.0), uDark > 0.5 ? 0.04 : 0.06);
            color += grain * (uDark > 0.5 ? 0.010 : 0.014);

            float edgeFade = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x) * smoothstep(0.0, 0.10, vUv.y) * smoothstep(1.0, 0.90, vUv.y);
            float alpha = edgeFade * (uDark > 0.5 ? 0.18 : 0.16);

            gl_FragColor = vec4(color, alpha);
          }
        `,
        })

        const geometry = new THREE.PlaneGeometry(2, 2)
        const mesh = new THREE.Mesh(geometry, material)
        scene.add(mesh)

        const resize = () => {
          const rect = canvas.getBoundingClientRect()
          renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false)
        }

        const render = (time: number) => {
          resize()
          material.uniforms.uTime.value = time * 0.001
          renderer.render(scene, camera)
          animationFrame = window.requestAnimationFrame(render)
        }

        console.info('[Reffo visual-tier]', {
          scope: 'home-card',
          renderMode: 'three',
          status: 'mounted',
          tone,
          accentColor,
          surfaceColor,
          pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        })
        render(0)
      } catch (error) {
        console.warn('[Reffo visual-tier]', {
          scope: 'home-card',
          renderMode: 'three',
          status: 'failed',
          error,
        })
      }
    }

    start()

    return () => {
      disposed = true
      window.cancelAnimationFrame(animationFrame)
      material?.dispose?.()
      renderer?.dispose?.()
    }
  }, [accentColor, surfaceColor, tone])

  return <canvas ref={canvasRef} className='reffo-home-card__premium-canvas' />
}
