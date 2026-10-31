import * as THREE from 'three';

/**
 * Builds a multi-part 3D furnished study environment so users can immediately
 * test placing memory pins on furniture, walking within 2 meters to trigger
 * headers, and dragging a 3D focus zone over the desk or room surfaces.
 * Can be toggled off for pure real-world AR camera passthrough.
 */
export class StudyRoomBuilder {
  public readonly root = new THREE.Group();
  public readonly interactableMeshes: THREE.Object3D[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];

  constructor() {
    this.root.name = 'LotusStudyRoom';
    this.buildFloorAndWalls();
    this.buildStudyDeskUnit();
    this.buildBookshelfUnit();
    this.buildWhiteboardUnit();
    this.buildLoungeUnit();
    this.buildFloorLampUnit();
    this.buildLotusPlanterUnit();
  }

  private trackGeo<T extends THREE.BufferGeometry>(geo: T): T {
    this.geometries.push(geo);
    return geo;
  }

  private trackMat<T extends THREE.Material>(mat: T): T {
    this.materials.push(mat);
    return mat;
  }

  private tagSurface(obj: THREE.Object3D, label: string) {
    obj.userData.surfaceLabel = label;
    obj.traverse((child) => {
      child.userData.surfaceLabel = label;
    });
    this.interactableMeshes.push(obj);
  }

  private buildFloorAndWalls() {
    const floorGroup = new THREE.Group();

    // Ground floor plane
    const floorGeo = this.trackGeo(new THREE.PlaneGeometry(7.2, 7.2));
    const floorMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x111622,
        roughness: 0.85,
        metalness: 0.08,
      }),
    );
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    floorMesh.userData.surfaceLabel = 'Study Room Floor';
    floorGroup.add(floorMesh);
    this.interactableMeshes.push(floorMesh);

    // Subtle architectural grid on floor (with polygonOffset to prevent z-fighting)
    const gridHelper = new THREE.GridHelper(7.0, 28, 0x334155, 0x1e293b);
    gridHelper.position.y = 0.003;
    (gridHelper.material as THREE.Material).transparent = true;
    (gridHelper.material as THREE.Material).opacity = 0.45;
    (gridHelper as unknown as {xb?: {pointerEvents: string}}).xb = {
      pointerEvents: 'none',
    };
    floorGroup.add(gridHelper);

    // Woven area rug under desk & lounge
    const rugGeo = this.trackGeo(new THREE.BoxGeometry(3.4, 0.012, 2.2));
    const rugMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x1e2638,
        roughness: 0.94,
        metalness: 0.02,
      }),
    );
    const rug = new THREE.Mesh(rugGeo, rugMat);
    rug.position.set(0, 0.008, -1.35);
    rug.receiveShadow = true;
    rug.userData.surfaceLabel = 'Study Area Rug';
    floorGroup.add(rug);
    this.interactableMeshes.push(rug);

    // Back accent wall (subtle architectural backdrop)
    const backWallGeo = this.trackGeo(new THREE.BoxGeometry(5.6, 2.7, 0.08));
    const backWallMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x151c2c,
        roughness: 0.78,
        metalness: 0.06,
      }),
    );
    const backWall = new THREE.Mesh(backWallGeo, backWallMat);
    backWall.position.set(0, 1.35, -2.38);
    backWall.receiveShadow = true;
    backWall.userData.surfaceLabel = 'North Study Wall';
    floorGroup.add(backWall);
    this.interactableMeshes.push(backWall);

    // Baseboard trim
    const trimGeo = this.trackGeo(new THREE.BoxGeometry(5.62, 0.09, 0.095));
    const trimMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x263147,
        roughness: 0.5,
        metalness: 0.2,
      }),
    );
    const trim = new THREE.Mesh(trimGeo, trimMat);
    trim.position.set(0, 0.045, -2.37);
    trim.userData.surfaceLabel = 'North Study Wall';
    floorGroup.add(trim);

    this.root.add(floorGroup);
  }

  /**
   * 10-part Study Desk assembly:
   * Tabletop, beveled edge trim, 4 steel legs, laptop base + screen,
   * open notebook + pen, desk task lamp.
   */
  private buildStudyDeskUnit() {
    const deskGroup = new THREE.Group();
    deskGroup.position.set(0, 0, -1.48);

    const woodMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x7c5836,
        roughness: 0.52,
        metalness: 0.08,
      }),
    );
    const darkMetalMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.28,
        metalness: 0.82,
      }),
    );
    const brushedAluminumMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xcbd5e1,
        roughness: 0.24,
        metalness: 0.88,
      }),
    );

    // 1. Main Desktop Slab (height 0.74m)
    const topGeo = this.trackGeo(new THREE.BoxGeometry(1.44, 0.04, 0.74));
    const topMesh = new THREE.Mesh(topGeo, woodMat);
    topMesh.position.set(0, 0.73, 0);
    topMesh.castShadow = true;
    topMesh.receiveShadow = true;
    deskGroup.add(topMesh);

    // 2. Under-desk structural frame
    const frameGeo = this.trackGeo(new THREE.BoxGeometry(1.34, 0.035, 0.64));
    const frameMesh = new THREE.Mesh(frameGeo, darkMetalMat);
    frameMesh.position.set(0, 0.695, 0);
    deskGroup.add(frameMesh);

    // 3–6. Four cylindrical tapered steel legs
    const legGeo = this.trackGeo(
      new THREE.CylinderGeometry(0.022, 0.016, 0.71, 16),
    );
    const legOffsets = [
      [-0.64, -0.29],
      [0.64, -0.29],
      [-0.64, 0.29],
      [0.64, 0.29],
    ];
    for (const [lx, lz] of legOffsets) {
      const leg = new THREE.Mesh(legGeo, darkMetalMat);
      leg.position.set(lx, 0.355, lz);
      leg.castShadow = true;
      deskGroup.add(leg);
    }

    // 7. Laptop Base on Desk
    const laptopBaseGeo = this.trackGeo(
      new THREE.BoxGeometry(0.32, 0.012, 0.22),
    );
    const laptopBase = new THREE.Mesh(laptopBaseGeo, brushedAluminumMat);
    laptopBase.position.set(0.14, 0.756, -0.04);
    laptopBase.castShadow = true;
    deskGroup.add(laptopBase);

    // 8. Laptop Screen (angled open)
    const laptopScreenGeo = this.trackGeo(
      new THREE.BoxGeometry(0.32, 0.21, 0.008),
    );
    const laptopScreen = new THREE.Mesh(laptopScreenGeo, brushedAluminumMat);
    laptopScreen.position.set(0.14, 0.855, -0.165);
    laptopScreen.rotation.x = -0.22;
    deskGroup.add(laptopScreen);

    // Glowing display inner panel
    const displayGeo = this.trackGeo(new THREE.PlaneGeometry(0.295, 0.185));
    const displayMat = this.trackMat(
      new THREE.MeshBasicMaterial({color: 0x0ea5e9}),
    );
    const displayMesh = new THREE.Mesh(displayGeo, displayMat);
    displayMesh.position.set(0, 0, 0.005);
    laptopScreen.add(displayMesh);

    // 9. Study Notebook on left side of desk
    const notebookCoverGeo = this.trackGeo(
      new THREE.BoxGeometry(0.24, 0.016, 0.3),
    );
    const notebookMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xf8fafc,
        roughness: 0.75,
        metalness: 0.04,
      }),
    );
    const notebook = new THREE.Mesh(notebookCoverGeo, notebookMat);
    notebook.position.set(-0.28, 0.758, 0.06);
    notebook.rotation.y = 0.12;
    notebook.castShadow = true;
    deskGroup.add(notebook);

    // 10. Architect Desk Lamp on top-right corner of desk
    const lampBaseGeo = this.trackGeo(
      new THREE.CylinderGeometry(0.08, 0.09, 0.02, 24),
    );
    const brassMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xd97706,
        roughness: 0.25,
        metalness: 0.85,
      }),
    );
    const lampBase = new THREE.Mesh(lampBaseGeo, brassMat);
    lampBase.position.set(0.52, 0.76, -0.2);
    deskGroup.add(lampBase);

    const lampStemGeo = this.trackGeo(
      new THREE.CylinderGeometry(0.01, 0.01, 0.36, 12),
    );
    const lampStem = new THREE.Mesh(lampStemGeo, brassMat);
    lampStem.position.set(0.54, 0.93, -0.22);
    lampStem.rotation.z = 0.15;
    deskGroup.add(lampStem);

    const lampShadeGeo = this.trackGeo(
      new THREE.ConeGeometry(0.075, 0.12, 24, 1, true),
    );
    const lampShade = new THREE.Mesh(lampShadeGeo, brassMat);
    lampShade.position.set(0.47, 1.08, -0.18);
    lampShade.rotation.z = 0.42;
    deskGroup.add(lampShade);

    // Ergonomic Desk Chair tucked slightly out
    const chairGroup = new THREE.Group();
    chairGroup.position.set(0, 0, 0.55);
    const seatGeo = this.trackGeo(new THREE.BoxGeometry(0.46, 0.05, 0.44));
    const cushionMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.8,
        metalness: 0.05,
      }),
    );
    const seat = new THREE.Mesh(seatGeo, cushionMat);
    seat.position.set(0, 0.46, 0);
    seat.castShadow = true;
    chairGroup.add(seat);

    const backRestGeo = this.trackGeo(new THREE.BoxGeometry(0.44, 0.38, 0.045));
    const backRest = new THREE.Mesh(backRestGeo, cushionMat);
    backRest.position.set(0, 0.68, 0.21);
    backRest.rotation.x = 0.1;
    backRest.castShadow = true;
    chairGroup.add(backRest);

    const pedestalGeo = this.trackGeo(
      new THREE.CylinderGeometry(0.025, 0.025, 0.44, 16),
    );
    const pedestal = new THREE.Mesh(pedestalGeo, darkMetalMat);
    pedestal.position.set(0, 0.22, 0);
    chairGroup.add(pedestal);

    const chairBaseGeo = this.trackGeo(
      new THREE.CylinderGeometry(0.24, 0.24, 0.025, 6),
    );
    const chairBase = new THREE.Mesh(chairBaseGeo, darkMetalMat);
    chairBase.position.set(0, 0.02, 0);
    chairGroup.add(chairBase);

    this.tagSurface(chairGroup, 'Desk Chair');
    this.root.add(chairGroup);

    this.tagSurface(deskGroup, 'Study Desk');
    this.root.add(deskGroup);
  }

  /**
   * Multi-part Tall Bookshelf with 5 shelves and colorful book volumes.
   */
  private buildBookshelfUnit() {
    const shelfGroup = new THREE.Group();
    shelfGroup.position.set(-1.68, 0, -1.72);
    shelfGroup.rotation.y = 0.28;

    const frameMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x292524,
        roughness: 0.62,
        metalness: 0.12,
      }),
    );

    // Side uprights
    const sideGeo = this.trackGeo(new THREE.BoxGeometry(0.035, 1.82, 0.36));
    const leftSide = new THREE.Mesh(sideGeo, frameMat);
    leftSide.position.set(-0.42, 0.91, 0);
    leftSide.castShadow = true;
    const rightSide = new THREE.Mesh(sideGeo, frameMat);
    rightSide.position.set(0.42, 0.91, 0);
    rightSide.castShadow = true;
    shelfGroup.add(leftSide, rightSide);

    // 5 Horizontal shelves
    const plankGeo = this.trackGeo(new THREE.BoxGeometry(0.84, 0.028, 0.35));
    const shelfHeights = [0.08, 0.48, 0.88, 1.28, 1.72];
    for (const h of shelfHeights) {
      const plank = new THREE.Mesh(plankGeo, frameMat);
      plank.position.set(0, h, 0);
      plank.receiveShadow = true;
      shelfGroup.add(plank);
    }

    // Book clusters on shelves
    const bookColors = [0x0ea5e9, 0xf59e0b, 0x10b981, 0xe11d48, 0x94a3b8];
    for (let s = 1; s <= 3; s++) {
      const baseY = shelfHeights[s] + 0.015;
      for (let b = 0; b < 5; b++) {
        const bh = 0.21 + (b % 3) * 0.03;
        const bw = 0.042;
        const bookGeo = this.trackGeo(new THREE.BoxGeometry(bw, bh, 0.22));
        const bookMat = this.trackMat(
          new THREE.MeshStandardMaterial({
            color: bookColors[(s + b) % bookColors.length],
            roughness: 0.7,
            metalness: 0.05,
          }),
        );
        const book = new THREE.Mesh(bookGeo, bookMat);
        book.position.set(-0.28 + b * 0.052, baseY + bh / 2, 0);
        shelfGroup.add(book);
      }
    }

    this.tagSurface(shelfGroup, 'Tall Bookshelf');
    this.root.add(shelfGroup);
  }

  /**
   * Wall-mounted Glass/Enamel Whiteboard above the study desk.
   */
  private buildWhiteboardUnit() {
    const boardGroup = new THREE.Group();
    boardGroup.position.set(0, 1.56, -2.31);

    const frameGeo = this.trackGeo(new THREE.BoxGeometry(1.36, 0.78, 0.024));
    const frameMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x475569,
        roughness: 0.3,
        metalness: 0.78,
      }),
    );
    const frame = new THREE.Mesh(frameGeo, frameMat);
    boardGroup.add(frame);

    const surfaceGeo = this.trackGeo(new THREE.BoxGeometry(1.3, 0.72, 0.028));
    const surfaceMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xf1f5f9,
        roughness: 0.22,
        metalness: 0.05,
      }),
    );
    const surface = new THREE.Mesh(surfaceGeo, surfaceMat);
    boardGroup.add(surface);

    // Marker tray at bottom of whiteboard
    const trayGeo = this.trackGeo(new THREE.BoxGeometry(0.6, 0.02, 0.06));
    const tray = new THREE.Mesh(trayGeo, frameMat);
    tray.position.set(0, -0.38, 0.03);
    boardGroup.add(tray);

    this.tagSurface(boardGroup, 'Wall Whiteboard');
    this.root.add(boardGroup);
  }

  /**
   * Lounge reading corner on the right side: Armchair + Round Side Table.
   */
  private buildLoungeUnit() {
    // Round Side Table
    const tableGroup = new THREE.Group();
    tableGroup.position.set(1.55, 0, -1.22);

    const topGeo = this.trackGeo(
      new THREE.CylinderGeometry(0.28, 0.28, 0.03, 32),
    );
    const marbleMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        roughness: 0.3,
        metalness: 0.1,
      }),
    );
    const top = new THREE.Mesh(topGeo, marbleMat);
    top.position.set(0, 0.56, 0);
    top.castShadow = true;
    top.receiveShadow = true;
    tableGroup.add(top);

    const stemGeo = this.trackGeo(
      new THREE.CylinderGeometry(0.025, 0.025, 0.54, 16),
    );
    const stemMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        roughness: 0.3,
        metalness: 0.85,
      }),
    );
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.position.set(0, 0.28, 0);
    tableGroup.add(stem);

    const baseGeo = this.trackGeo(
      new THREE.CylinderGeometry(0.18, 0.2, 0.025, 24),
    );
    const base = new THREE.Mesh(baseGeo, stemMat);
    base.position.set(0, 0.0125, 0);
    tableGroup.add(base);

    this.tagSurface(tableGroup, 'Lounge Side Table');
    this.root.add(tableGroup);

    // Lounge Armchair
    const chairGroup = new THREE.Group();
    chairGroup.position.set(1.62, 0, -1.85);
    chairGroup.rotation.y = -0.52;

    const fabricMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x1e3a5f,
        roughness: 0.88,
        metalness: 0.04,
      }),
    );
    const seatGeo = this.trackGeo(new THREE.BoxGeometry(0.68, 0.16, 0.64));
    const seat = new THREE.Mesh(seatGeo, fabricMat);
    seat.position.set(0, 0.36, 0);
    seat.castShadow = true;
    chairGroup.add(seat);

    const backGeo = this.trackGeo(new THREE.BoxGeometry(0.68, 0.48, 0.14));
    const back = new THREE.Mesh(backGeo, fabricMat);
    back.position.set(0, 0.62, -0.26);
    back.rotation.x = -0.15;
    back.castShadow = true;
    chairGroup.add(back);

    const armGeo = this.trackGeo(new THREE.BoxGeometry(0.11, 0.28, 0.62));
    const leftArm = new THREE.Mesh(armGeo, fabricMat);
    leftArm.position.set(-0.34, 0.48, 0);
    const rightArm = new THREE.Mesh(armGeo, fabricMat);
    rightArm.position.set(0.34, 0.48, 0);
    chairGroup.add(leftArm, rightArm);

    this.tagSurface(chairGroup, 'Lounge Armchair');
    this.root.add(chairGroup);
  }

  /**
   * Minimalist Warm Standing Floor Lamp.
   */
  private buildFloorLampUnit() {
    const lampGroup = new THREE.Group();
    lampGroup.position.set(1.12, 0, -2.05);

    const metalMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        roughness: 0.25,
        metalness: 0.85,
      }),
    );
    const baseGeo = this.trackGeo(
      new THREE.CylinderGeometry(0.16, 0.18, 0.03, 24),
    );
    const base = new THREE.Mesh(baseGeo, metalMat);
    base.position.set(0, 0.015, 0);
    lampGroup.add(base);

    const poleGeo = this.trackGeo(
      new THREE.CylinderGeometry(0.014, 0.018, 1.58, 16),
    );
    const pole = new THREE.Mesh(poleGeo, metalMat);
    pole.position.set(0, 0.79, 0);
    lampGroup.add(pole);

    const shadeGeo = this.trackGeo(
      new THREE.CylinderGeometry(0.14, 0.2, 0.26, 24, 1, true),
    );
    const shadeMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xfef3c7,
        emissive: 0xf59e0b,
        emissiveIntensity: 0.4,
        roughness: 0.6,
        side: THREE.DoubleSide,
      }),
    );
    const shade = new THREE.Mesh(shadeGeo, shadeMat);
    shade.position.set(0, 1.56, 0);
    lampGroup.add(shade);

    this.tagSurface(lampGroup, 'Standing Floor Lamp');
    this.root.add(lampGroup);
  }

  /**
   * Architectural Sculptural Lotus Planter on the left flank.
   */
  private buildLotusPlanterUnit() {
    const planterGroup = new THREE.Group();
    planterGroup.position.set(-1.12, 0, -2.02);

    const potGeo = this.trackGeo(
      new THREE.CylinderGeometry(0.18, 0.13, 0.38, 24),
    );
    const potMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.75,
        metalness: 0.1,
      }),
    );
    const pot = new THREE.Mesh(potGeo, potMat);
    pot.position.set(0, 0.19, 0);
    pot.castShadow = true;
    planterGroup.add(pot);

    const leafMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x059669,
        roughness: 0.55,
        metalness: 0.08,
      }),
    );
    const leafGeo = this.trackGeo(new THREE.ConeGeometry(0.08, 0.42, 7));
    const angles = [0, 1.2, 2.4, 3.6, 4.8];
    angles.forEach((ang, idx) => {
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.position.set(
        Math.cos(ang) * 0.05,
        0.46 + (idx % 2) * 0.06,
        Math.sin(ang) * 0.05,
      );
      leaf.rotation.x = Math.sin(ang) * 0.28;
      leaf.rotation.z = -Math.cos(ang) * 0.28;
      planterGroup.add(leaf);
    });

    this.tagSurface(planterGroup, 'Lotus Planter');
    this.root.add(planterGroup);
  }

  public setVisible(visible: boolean) {
    this.root.visible = visible;
  }

  public dispose() {
    for (const geo of this.geometries) geo.dispose();
    for (const mat of this.materials) mat.dispose();
  }
}
