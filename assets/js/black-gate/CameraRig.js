import * as THREE from 'three';
import { TIMING } from './config.js';

/**
 * 視点中央からの見回し。
 * 3基の扉を 120° 間隔で見るため、ヨーは一周できるようにする。
 */
export class CameraRig {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} el
   */
  constructor(camera, el) {
    this.camera = camera;
    this.el = el;

    /** 視線の基準点（フォーカス対象） */
    this.anchor = new THREE.Vector3(0, 1.35, -9.6);
    /** カメラの立ち位置（リングの中心） */
    this.position = new THREE.Vector3(0, 1.52, 0);

    this.baseYaw = 0;
    this.basePitch = 0;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.lookYawTarget = 0;
    this.lookPitchTarget = 0;
    this.sensYaw = 0;
    this.sensPitch = 0;

    // 一周見回せる
    this.yawMin = -Math.PI;
    this.yawMax = Math.PI;
    this.pitchMin = -0.18;
    this.pitchMax = 0.28;
    this.lookYawRange = 0.28;
    this.lookPitchRange = 0.1;
    this.lookFollowSpeed = 2.2;

    this.target = this.anchor.clone();
    this.distance = 9.6;

    this.sensorEnabled = false;
    this.sensorBase = null;
    this._onOrient = null;
    this.focusAnim = null;

    this.pointerId = null;
    this.dragMoved = false;
    this.downX = 0;
    this.downY = 0;
    this.lastX = 0;
    this.lastY = 0;

    this.onTap = null;
    this.pointerInside = false;

    this._lookDir = new THREE.Vector3();
    this._lookAt = new THREE.Vector3();

    this._bind();
    this.apply();
  }

  get yaw() {
    return wrapAngle(this.baseYaw + this.lookYaw + this.sensYaw);
  }

  get pitch() {
    return THREE.MathUtils.clamp(
      this.basePitch + this.lookPitch + this.sensPitch,
      this.pitchMin,
      this.pitchMax,
    );
  }

  /**
   * @param {number} nx -1..1
   * @param {number} ny -1..1
   * @param {boolean} inside
   */
  setPointerLook(nx, ny, inside) {
    this.pointerInside = inside;
    if (!inside) {
      this.lookYawTarget = 0;
      this.lookPitchTarget = 0;
      return;
    }
    const w = this.sensorEnabled ? 0.15 : 1;
    this.lookYawTarget = THREE.MathUtils.clamp(nx, -1, 1) * this.lookYawRange * w;
    this.lookPitchTarget = THREE.MathUtils.clamp(-ny, -1, 1) * this.lookPitchRange * w;
  }

  _bind() {
    const el = this.el;

    el.addEventListener('pointerenter', () => {
      this.pointerInside = true;
    });
    el.addEventListener('pointerleave', () => {
      this.pointerInside = false;
      this.pointerId = null;
      this.lookYawTarget = 0;
      this.lookPitchTarget = 0;
    });

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      this.pointerId = e.pointerId;
      this.dragMoved = false;
      this.downX = this.lastX = e.clientX;
      this.downY = this.lastY = e.clientY;
      try {
        el.setPointerCapture(e.pointerId);
      } catch (_) {
        /* ignore */
      }
    });

    el.addEventListener('pointermove', (e) => {
      if (this.pointerId !== e.pointerId) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      const dist = Math.hypot(e.clientX - this.downX, e.clientY - this.downY);
      if (dist > 8) this.dragMoved = true;
      if (!this.dragMoved) return;

      if (Math.abs(dx) >= Math.abs(dy) * 0.65 || e.pointerType === 'mouse') {
        this.baseYaw = wrapAngle(this.baseYaw - dx * 0.0055);
        this.basePitch = THREE.MathUtils.clamp(
          this.basePitch + dy * 0.0035,
          this.pitchMin,
          this.pitchMax,
        );
        this.cancelFocus();
        if (e.cancelable && Math.abs(dx) > Math.abs(dy)) e.preventDefault();
      }
    });

    el.addEventListener('pointerup', (e) => {
      if (this.pointerId !== e.pointerId) return;
      const wasDrag = this.dragMoved;
      this.pointerId = null;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch (_) {
        /* ignore */
      }
      if (!wasDrag && this.onTap) this.onTap(e);
    });

    el.addEventListener('pointercancel', () => {
      this.pointerId = null;
    });

    el.style.touchAction = 'pan-y';
  }

  cancelFocus() {
    this.focusAnim = null;
  }

  /** 指定方位（ラジアン）へ視線を滑らかに寄せる */
  focusYaw(targetYaw, worldPoint) {
    if (worldPoint) {
      this.anchor.copy(worldPoint);
      this.target.copy(worldPoint);
    }
    const startYaw = this.yaw;
    let delta = wrapAngle(targetYaw - startYaw);
    this.focusAnim = {
      start: {
        yaw: startYaw,
        pitch: this.basePitch,
        t: 0,
      },
      end: {
        yaw: startYaw + delta,
        pitch: 0,
      },
      duration: TIMING.cameraFocusDuration,
    };
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.lookYawTarget = 0;
    this.lookPitchTarget = 0;
    this.sensYaw = 0;
    this.sensPitch = 0;
  }

  /** 扉ワールド座標へ視線を寄せる */
  focusOn(worldPoint) {
    const dir = worldPoint.clone().sub(this.position);
    const targetYaw = Math.atan2(dir.x, -dir.z);
    this.focusYaw(targetYaw, worldPoint);
  }

  apply() {
    const yaw = this.yaw;
    const pitch = this.pitch;
    const cp = Math.cos(pitch);
    this._lookDir.set(Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp).normalize();
    this._lookAt.copy(this.position).addScaledVector(this._lookDir, 12);

    this.camera.position.copy(this.position);
    this.camera.position.y = Math.max(0.7, this.camera.position.y);
    this.camera.lookAt(this._lookAt);
    this.target.copy(this._lookAt);
  }

  /** @param {number} dt */
  update(dt) {
    const follow = 1 - Math.exp(-this.lookFollowSpeed * dt);
    this.lookYaw += (this.lookYawTarget - this.lookYaw) * follow;
    this.lookPitch += (this.lookPitchTarget - this.lookPitch) * follow;

    if (this.focusAnim) {
      const a = this.focusAnim;
      a.start.t += dt;
      const u = Math.min(1, a.start.t / a.duration);
      const e = 1 - Math.pow(1 - u, 3);
      this.baseYaw = wrapAngle(THREE.MathUtils.lerp(a.start.yaw, a.end.yaw, e));
      this.basePitch = THREE.MathUtils.lerp(a.start.pitch, a.end.pitch, e);
      this.lookYaw *= 1 - e;
      this.lookPitch *= 1 - e;
      this.sensYaw *= 1 - e;
      this.sensPitch *= 1 - e;
      if (u >= 1) {
        this.baseYaw = wrapAngle(a.end.yaw);
        this.focusAnim = null;
        if (this.sensorEnabled) this.sensorBase = null;
      }
    }
    this.apply();
  }

  /**
   * @returns {Promise<{ok:boolean, reason?:string}>}
   */
  async enableSensor() {
    if (this.sensorEnabled) return { ok: true };

    const DOE = window.DeviceOrientationEvent;
    if (!DOE) {
      return { ok: false, reason: 'この端末は向きセンサーに対応していません。スワイプで見渡せます。' };
    }

    try {
      if (typeof DOE.requestPermission === 'function') {
        const perm = await DOE.requestPermission();
        if (perm !== 'granted') {
          return { ok: false, reason: 'センサーの許可が得られませんでした。スワイプで見渡せます。' };
        }
      }
    } catch (_) {
      return { ok: false, reason: 'センサー許可の要求に失敗しました。スワイプで見渡せます。' };
    }

    this.sensorBase = null;
    this.sensYaw = 0;
    this.sensPitch = 0;
    this.lookYawTarget = 0;
    this.lookPitchTarget = 0;

    this._onOrient = (ev) => {
      if (ev.alpha == null || ev.beta == null) return;
      if (!this.sensorBase) {
        this.sensorBase = { alpha: ev.alpha, beta: ev.beta };
        return;
      }
      let dAlpha = ev.alpha - this.sensorBase.alpha;
      if (dAlpha > 180) dAlpha -= 360;
      if (dAlpha < -180) dAlpha += 360;
      const dBeta = ev.beta - this.sensorBase.beta;
      this.sensYaw = THREE.MathUtils.degToRad(-dAlpha) * 1.1;
      this.sensPitch = THREE.MathUtils.degToRad(dBeta) * 0.55;
      this.cancelFocus();
    };

    window.addEventListener('deviceorientation', this._onOrient, true);
    this.sensorEnabled = true;
    return { ok: true };
  }

  disableSensor() {
    if (this._onOrient) {
      window.removeEventListener('deviceorientation', this._onOrient, true);
      this._onOrient = null;
    }
    this.sensorEnabled = false;
    this.sensorBase = null;
    this.sensYaw = 0;
    this.sensPitch = 0;
  }

  dispose() {
    this.disableSensor();
  }
}

function wrapAngle(a) {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}
