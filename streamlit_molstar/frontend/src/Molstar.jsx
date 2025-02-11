import React, { useEffect, useRef, useState } from "react"
import PropTypes from "prop-types"
import { DefaultPluginUISpec } from "@dp-launching/molstar/lib/mol-plugin-ui/spec"
import {
  QualityAssessmentPLDDTPreset,
  QualityAssessmentQmeanPreset,
} from "@dp-launching/molstar/lib/extensions/model-archive/quality-assessment/behavior"
import { QualityAssessment } from "@dp-launching/molstar/lib/extensions/model-archive/quality-assessment/prop"
import { TrajectoryFromModelAndCoordinates } from "@dp-launching/molstar/lib/mol-plugin-state/transforms/model"
import { StateTransforms } from "@dp-launching/molstar/lib/mol-plugin-state/transforms"
import { PluginConfig } from "@dp-launching/molstar/lib/mol-plugin/config"
import "@dp-launching/molstar/build/viewer/molstar.css"
import { ParamDefinition } from "@dp-launching/molstar/lib/mol-util/param-definition"
import { CameraHelperParams } from "@dp-launching/molstar/lib/mol-canvas3d/helper/camera-helper"
import { OpenFiles } from "@dp-launching/molstar/lib/mol-plugin-state/actions/file"
import { Asset } from "@dp-launching/molstar/lib/mol-util/assets"
import {
  PresetStructureRepresentations,
  StructureRepresentationPresetProvider,
} from "@dp-launching/molstar/lib/mol-plugin-state/builder/structure/representation-preset"
import {
  StateObjectRef,
  StateSelection,
} from "@dp-launching/molstar/lib/mol-state"
import {
  presetStaticComponent,
  presetSelectionComponent,
} from "@dp-launching/molstar/lib/mol-plugin-state/builder/structure/representation-preset"

import { StructureSelectionQuery } from "@dp-launching/molstar/lib/mol-plugin-state/helpers/structure-selection-query"

import { PluginCommands } from "@dp-launching/molstar/lib/mol-plugin/commands"
import { StructureFromModel } from "@dp-launching/molstar/lib/mol-plugin-state/transforms/model"
import { Material } from "@dp-launching/molstar/lib/mol-util/material"

import { StructureComponentManager } from "@dp-launching/molstar/lib/mol-plugin-state/manager/structure/component"
import { createPluginUI } from "./create-plugin-ui"
import { ColorNames } from "@dp-launching/molstar/lib/mol-util/color/names"
import { createStructureRepresentationParams } from "@dp-launching/molstar/lib/mol-plugin-state/helpers/structure-representation-params"
import { Script } from "@dp-launching/molstar/lib/mol-script/script"
import { StructureSelection } from "@dp-launching/molstar/lib/mol-model/structure/query"
import { compileIdListSelection } from "@dp-launching/molstar/lib/mol-script/util/id-list"
import { Structure } from "@dp-launching/molstar/lib/mol-model/structure/structure"
import {
  MolScriptBuilder as MS,
  MolScriptBuilder,
} from "@dp-launching/molstar/lib/mol-script/language/builder"

import {
  changeCameraRotation,
  ROTATION_MATRICES,
} from "@dp-launching/molstar/lib/mol-plugin-state/manager/focus-camera/orient-axes"

import { Mat3 } from "@dp-launching/molstar/lib/mol-math/linear-algebra/3d/mat3"

import { rotateBy, rotateX, rotateY, rotateZ } from "./CameraHelper"
// import { StructureSelectionManager } from "@dp-launching/molstar/lib/mol-plugin-state/manager/structure/selection"
// import { Color } from "@dp-launching/molstar/lib/mol-util/color/color"

// import { getSelectionFromChainAuthId } from

const defaultColor = ColorNames.white
const hotspotColor = 0x09847a
const secondaryColor = 0x003660

const CustomMaterial = Material({ roughness: 1, metalness: 0 })

const PresetParams = {
  ...StructureRepresentationPresetProvider.CommonParams,
}

const DefaultSurfaceParams = {
  type: "gaussian-surface",
  typeParams: { alpha: 1, material: CustomMaterial, sizeFactor: 1 },
  color: "uniform",
  colorParams: { value: defaultColor },
}
const DefaultCartoonParams = {
  type: "cartoon",
  typeParams: { alpha: 1, sizeFactor: 0.2 },
  color: "secondary_structure",
}

const DefaultViewerParams = {}

const HotspotSurfaceParams = {
  type: "gaussian-surface",
  typeParams: {
    quality: "Highest",
    alpha: 1,
    material: CustomMaterial,
    sizeFactor: 1,
  },
  color: "uncertainty",
  colorParams: {
    domain: [2.5, 6],
    list: {
      colors: [defaultColor, defaultColor, hotspotColor],
    },
  },
}

const BinderCartoonParams = {
  type: "cartoon",
  color: "sequence-id",
  // colorParams: {
  //   value: ColorNames.cornflowerblue,
  // },
}

function get_url_from_data(data, isBinary) {
  var blob
  if (isBinary) {
    blob = new Blob([data], { type: "application/octet-stream" })
  } else {
    blob = new Blob([data], { type: "text/plain" })
  }
  return URL.createObjectURL(blob)
}

function getSelectionQueryFromMolscript(chainId, positions) {
  const chainTestQuery =
    chainId !== ""
      ? MS.core.rel.eq([
          MS.struct.atomProperty.macromolecular.label_asym_id(),
          chainId,
        ])
      : undefined
  const residueTestQuery =
    positions && positions.length !== 0
      ? MS.core.set.has([
          MS.set(...positions),
          MS.struct.atomProperty.macromolecular.auth_seq_id(),
        ])
      : undefined

  if (!chainTestQuery && !residueTestQuery) {
    return undefined
  }

  let atomGroups = {}
  if (chainTestQuery) {
    atomGroups["chain-test"] = chainTestQuery
  }
  if (residueTestQuery) {
    atomGroups["residue-test"] = residueTestQuery
  }
  atomGroups["group-by"] = MS.struct.atomProperty.macromolecular.residueKey()
  const query = MS.struct.generator.atomGroups(atomGroups)
  return query
}

function inverseSelection(partialStructureExpression, fullStructureExpression) {
  return MS.struct.modifier.union([
    MS.struct.modifier.exceptBy({
      0: fullStructureExpression,
      by: partialStructureExpression,
    }),
  ])
}

function getSubstructure(structureCell, query) {
  console.log("getSubstructure of : ", structureCell)
  if (!structureCell) {
    return structureCell
  }

  return Script.getStructureSelection(query, structureCell.obj?.data)
}

export const addTrajectory = async (plugin, params) => {
  if (!plugin) return
  let model
  let coords
  if (params.model.kind === "model-data" || params.model.kind === "model-url") {
    const data =
      params.model.kind === "model-data"
        ? await plugin.builders.data.rawData({
            data: params.model.data,
            label: params.modelLabel,
          })
        : await plugin.builders.data.download({
            url: params.model.url,
            isBinary: params.model.isBinary,
            label: params.modelLabel,
          })

    const trajectory = await plugin.builders.structure.parseTrajectory(
      data,
      params.model.format ?? "mmcif"
    )
    model = await plugin.builders.structure.createModel(trajectory)
  } else {
    const data =
      params.model.kind === "topology-data"
        ? await plugin.builders.data.rawData({
            data: params.model.data,
            label: params.modelLabel,
          })
        : await plugin.builders.data.download({
            url: params.model.url,
            isBinary: params.model.isBinary,
            label: params.modelLabel,
          })

    const provider = plugin.dataFormats.get(params.model.format)
    model = await provider.parse(plugin, data)
  }
  {
    // FIXME coordinates-data is not supported
    if (params.coordinates.kind === "coordinates-data") {
      params.coordinates.url = get_url_from_data(
        params.coordinates.data,
        params.coordinates.isBinary
      )
      params.coordinates.kind = "coordinates-url"
    }
    const data =
      params.coordinates.kind === "coordinates-data"
        ? await plugin.builders.data.rawData({
            data: params.coordinates.data,
            label: params.coordinatesLabel,
          })
        : await plugin.builders.data.download({
            url: params.coordinates.url,
            isBinary: params.coordinates.isBinary,
            label: params.coordinatesLabel,
          })

    const provider = plugin.dataFormats.get(params.coordinates.format)
    coords = await provider.parse(plugin, data)
  }
  const trajectory = await plugin
    .build()
    .toRoot()
    .apply(
      TrajectoryFromModelAndCoordinates,
      {
        modelRef: model.ref,
        coordinatesRef: coords.ref,
      },
      { dependsOn: [model.ref, coords.ref] }
    )
    .apply(StateTransforms.Model.ModelFromTrajectory, { modelIndex: 0 })
    .commit()
  const structure = await plugin.builders.structure.createStructure(trajectory)
  await plugin.builders.structure.representation.applyPreset(structure, "auto")
}
const DefaultGaussianRepresentationPreset =
  StructureRepresentationPresetProvider({
    id: "default-gaussian-preset",
    display: { name: "Default" },
    params: () => PresetParams,
    async apply(ref, params, plugin) {
      const structureCell = StateObjectRef.resolveAndCheck(
        plugin.state.data,
        ref
      )
      const structure = structureCell?.obj?.data
      if (!structureCell || !structure) return {}

      const components = {
        ligand: await presetStaticComponent(plugin, structureCell, "all"),
      }

      const { update, builder, typeParams } =
        StructureRepresentationPresetProvider.reprBuilder(plugin, params)
      const representations = {
        ligand: builder.buildRepresentation(
          update,
          components.ligand,
          DefaultSurfaceParams
        ),
      }
      await update.commit({ revertOnError: true })
      plugin.managers.interactivity.setProps({ granularity: "element" })

      return { components, representations }
    },
  })

const DefaultHotspotRepresentationPreset =
  StructureRepresentationPresetProvider({
    id: "default-hotspot-preset",
    display: { name: "Hotspot" },
    params: () => PresetParams,
    async apply(ref, params, plugin) {
      const structureCell = StateObjectRef.resolveAndCheck(
        plugin.state.data,
        ref
      )
      const structure = structureCell?.obj?.data
      if (!structureCell || !structure) return {}

      const components = {
        ligand: await presetStaticComponent(plugin, structureCell, "all"),
        polymer: await presetStaticComponent(plugin, structureCell, "polymer"),
      }

      const { update, builder, typeParams } =
        StructureRepresentationPresetProvider.reprBuilder(plugin, params)
      const representations = {
        ligand: builder.buildRepresentation(
          update,
          components.ligand,
          HotspotSurfaceParams
        ),
      }
      await update.commit({ revertOnError: true })
      plugin.managers.interactivity.setProps({ granularity: "element" })

      return { components, representations }
    },
  })

const DefaultBinderRepresentationPreset = StructureRepresentationPresetProvider(
  {
    id: "default-binders-preset",
    display: { name: "Binders" },
    params: () => PresetParams,
    async apply(ref, params, plugin) {
      console.log("Applying preset: ", "default-binders-preset")
      const structureCell = StateObjectRef.resolveAndCheck(
        plugin.state.data,
        ref
      )
      const structure = structureCell?.obj?.data
      if (!structureCell || !structure) return {}

      // SELECTION CODE GOES HERE
      const binderTag = "binderTag"
      const targetTag = "targetTag"

      // Create Structure Expressions
      const fullStructureExpression = MS.struct.generator.all()
      const binderExpression = getSelectionQueryFromMolscript("N")
      const targetProteinExpression = inverseSelection(
        binderExpression,
        fullStructureExpression
      )

      // Create Selection Queries from Structure Expressions
      const binderSelectionQuery = StructureSelectionQuery(
        binderTag,
        binderExpression
      )
      const targetProteinSelectionQuery = StructureSelectionQuery(
        targetTag,
        targetProteinExpression
      )
      console.log("Binder Selection Query: ", binderSelectionQuery)
      console.log("Target Selection Query:", targetProteinSelectionQuery)

      const components = {
        ligand: await presetStaticComponent(plugin, structureCell, "all"),
        targetTag:
          await plugin.builders.structure.tryCreateComponentFromSelection(
            structureCell,
            targetProteinSelectionQuery,
            "selection-".concat(targetTag),
            params
          ),
        binderTag:
          await plugin.builders.structure.tryCreateComponentFromSelection(
            structureCell,
            binderSelectionQuery,
            "selection-".concat(binderTag),
            params
          ),
      }

      const { update, builder, typeParams } =
        StructureRepresentationPresetProvider.reprBuilder(plugin, params)
      const representations = {
        targetTag: builder.buildRepresentation(
          update,
          components.targetTag,
          DefaultSurfaceParams
        ),
        binderTag: builder.buildRepresentation(
          update,
          components.binderTag,
          BinderCartoonParams
        ),
      }

      await update.commit({ revertOnError: true })
      plugin.managers.interactivity.setProps({ granularity: "element" })
      return { components, representations }
    },
  }
)

const Molstar = (props) => {
  const {
    modelFile,
    trajFile,
    height = "100%",
    width = "100%",
    showAxes = false,
    defaultShowControls = false,
    showExpand = false,
    showControls = false,
    showSettings = false,
    showSelectionMode = false,
    showAnimation = false,
    showTrajectoryControls = false,
    preset_id = "",
    flag = false,

    molscriptSelectionResidues = [],
    molscriptSelectionChains = "",
  } = props
  const parentRef = useRef(null)
  const canvasRef = useRef(null)
  const plugin = useRef(null)

  const [initialized, setInitialized] = useState(false)
  const [defaultCameraSnapshot, setDefaultCameraSnapshot] = useState(null)

  function get_spec() {
    const spec = DefaultPluginUISpec()
    spec.layout = {
      initial: {
        isExpanded: true,
        controlsDisplay: "outside",
        showControls: defaultShowControls,
      },
    }
    const preset = DefaultGaussianRepresentationPreset.id
    spec.config = [
      [PluginConfig.Viewport.ShowExpand, showExpand],
      [PluginConfig.Viewport.ShowControls, showControls],
      [PluginConfig.Viewport.ShowSettings, showSettings],
      [PluginConfig.Viewport.ShowSelectionMode, showSelectionMode],
      [PluginConfig.Viewport.ShowAnimation, !showAnimation],
      [PluginConfig.Structure.DefaultRepresentationPreset, preset_id],
      [PluginConfig.Viewport.ShowTrajectoryControls, showTrajectoryControls],
    ]

    spec.canvas3d = {
      sceneRadiusFactor: 100,
      cameraResetDurationMs: 100,
      camera: {
        helper: {
          axes: {
            name: "off",
            params: {},
          },
        },
      },
      // viewport: {
      //   name: "canvas",
      //   params: {
      //     x: 0,
      //     y: 0,
      //     width: 100,
      //     height: 200,
      //   },
      // },
      marking: {
        selectEdgeColor: ColorNames.orange,
        selectEdgeStrength: 10,
      },
      renderer: {
        backgroundColor: ColorNames.white,
        selectColor: hotspotColor,
        xrayEdgeFalloff: 10,
        selectStrength: 0,
      },
      postprocessing: {
        outline: {
          name: "on",
          params: {
            scale: 3,
            threshold: 0.5,
            color: secondaryColor,
            includeTransparent: true,
          },
        },
      },
      trackball: {
        noScroll: false,
        rotateSpeed: 2,
        zoomSpeed: 0.2,
        panSpeed: 0.8,
        spin: true,
        spinSpeed: 1,
        staticMoving: false,
        dynamicDampingFactor: 0.06,
        minDistance: 0.01,
        maxDistance: 1e150,
      },
    }

    if (modelFile?.format === "gro" || trajFile?.format === "gro") {
      spec.behaviors = spec.behaviors.filter(
        (behavior) =>
          behavior.transformer.definition.name !==
          "create-structure-focus-representation"
      )
    }
    return spec
  }

  function getSelectionFromChainAuthId(chainId, positions) {
    // console.log("hiifdsajfk")
    if (!plugin.current.managers.structure.hierarchy.current.structures[0]) {
      console.log(!plugin.current.managers.structure.hierarchy.current)
      return
    }

    const query = getSelectionQueryFromMolscript(chainId, positions)

    return getSubstructure(
      plugin.current.managers.structure.hierarchy.current.structures[0].cell,
      query
    )
  }

  async function updateRepresentation() {
    if (!plugin || !plugin.current) {
      return
    }
    console.log("Update triggered by preset_id: ", preset_id)
    const a = new StructureComponentManager(plugin.current)
    if (preset_id === DefaultGaussianRepresentationPreset.id) {
      await a.applyPreset(
        plugin.current.managers.structure.hierarchy.selection.structures,
        DefaultGaussianRepresentationPreset
      )
    } else if (preset_id === DefaultHotspotRepresentationPreset.id) {
      await a.applyPreset(
        plugin.current.managers.structure.hierarchy.selection.structures,
        DefaultHotspotRepresentationPreset
      )
    } else if (preset_id === DefaultBinderRepresentationPreset.id) {
      await a.applyPreset(
        plugin.current.managers.structure.hierarchy.selection.structures,
        DefaultBinderRepresentationPreset
      )
    }
  }

  async function updateSelection() {
    if (!plugin || !plugin.current) {
      return
    }
    plugin.current.managers.interactivity.lociSelects.deselectAll()

    console.log("yooo")
    const selection = getSelectionFromChainAuthId(
      molscriptSelectionChains,
      molscriptSelectionResidues
    )
    console.log(selection)

    if (
      selection === null ||
      selection === undefined ||
      selection.kind === "singletons"
    ) {
      console.log("resetting camera")
      // plugin.current.managers.camera.resetAxes(500)
      // plugin.current.managers.camera.setSnapshot(defaultCameraSnapshot)
      await setDefaultCamera()
      return
    }

    const loci = StructureSelection.toLociWithSourceUnits(selection)

    plugin.current.managers.interactivity.lociSelects.select({
      loci: loci,
    })
    plugin.current.managers.camera.focusLoci(loci, {
      // minRadius: 1,
      // durationMs: 250,
      extraRadius: 30,
    })
  }

  async function setDefaultCamera() {
    if (!plugin || !plugin.current) {
      return
    }

    if (defaultCameraSnapshot === null) {
      console.log('setting default camera')
      plugin.current.managers.camera.resetAxes()
      const rotMatrix = rotateBy([
        rotateZ(-90),
        rotateY(125),
        rotateX(0),
        rotateZ(-30),
      ])
      const snapshot = changeCameraRotation(
        plugin.current.canvas3d.camera.getSnapshot(),
        rotMatrix
      )
      // console.log(defaultCameraSnapshot)
      setDefaultCameraSnapshot(snapshot)
      // console.log(snapshot)
      // console.log(defaultCameraSnapshot)
    }

    console.log(defaultCameraSnapshot)
    await plugin.current.managers.camera.setSnapshot(defaultCameraSnapshot)
  }

  useEffect(() => {
    async function init() {
      console.log("Initializing plugin!")
      const spec = get_spec()
      plugin.current = await createPluginUI(parentRef.current, spec, {
        onBeforeUIRender: (plugin) => {
          // the preset needs to be added before the UI renders otherwise
          // "Download Structure" wont be able to pick it up
          plugin.builders.structure.representation.registerPreset(
            DefaultGaussianRepresentationPreset
          )

          plugin.builders.structure.representation.registerPreset(
            DefaultHotspotRepresentationPreset
          )
          plugin.builders.structure.representation.registerPreset(
            DefaultBinderRepresentationPreset
          )
        },
      })
      await loadStructure(modelFile, trajFile, plugin.current)
      const sleep = (ms = 0) =>
        new Promise((resolve) => setTimeout(resolve, ms))

      await sleep(10)
      if (!plugin.current.canvas3d) return

      await updateRepresentation()
      await updateSelection()
      await setDefaultCamera()
    }
    init()
  }, [])

  useEffect(() => {
    async function update() {
      await setDefaultCamera()
    }
    update()
  }, [defaultCameraSnapshot])

  useEffect(() => {
    async function update() {
      await updateRepresentation()
      // await setDefaultCamera()
    }
    update()
  }, [preset_id])

  useEffect(() => {
    async function update() {
      console.log("Update triggered by modelFile.name: ", modelFile.name)
      await loadStructure(modelFile, trajFile, plugin.current)
      await updateRepresentation()
      await updateSelection()
      // await setDefaultCamera()
    }
    update()
  }, [modelFile.name])

  useEffect(() => {
    async function update() {
      console.log(
        "Update triggered by selected residues, chains, or modelFile.name:",
        molscriptSelectionResidues,
        molscriptSelectionChains,
        modelFile.name
      )
      updateSelection()
    }
    update()
  }, [molscriptSelectionResidues, molscriptSelectionChains, modelFile.name])

  useEffect(() => {
    async function update() {
      console.log("Updating triggered by flag: ", flag)
      if (!plugin || !plugin.current || !plugin.current.canvas3d) return
      const trackball = plugin.current.canvas3d.props.trackball
      await PluginCommands.Canvas3D.SetSettings(plugin.current, {
        settings: {
          trackball: {
            animate: flag
              ? { name: "spin", params: { speed: 1 } }
              : { name: "off", params: { speed: 0 } },
          },
        },
      })
    }
    update()
  }, [flag])

  const loadStructure = async (modelFile, trajFile, _plugin) => {
    console.log("hiiiii load struct")
    if (_plugin) {
      console.log("Loading structure...")
      _plugin.clear()
      if (trajFile) {
        await addTrajectory(_plugin, {
          model: {
            kind: modelFile.url ? "model-url" : "model-data",
            url: modelFile.url ? modelFile.url : undefined,
            data: modelFile.data ? modelFile.data : undefined,
            format: modelFile.format,
          },

          coordinates: {
            kind: trajFile.url ? "coordinates-url" : "coordinates-data",
            url: trajFile.url ? trajFile.url : undefined,
            data: trajFile.data ? trajFile.data : undefined,
            format: trajFile.format,
            isBinary: true,
          },
          preset: "all-models",
        })
      } else if (modelFile.data) {
        const asset = Asset.File(new File([modelFile.data], modelFile.name))
        // const data = await OpenFiles(plugin, {
        //   files: [asset],
        //    format: { name: 'auto', params: {} },
        //    visuals: true
        // });
        //PluginCommands.State.Snapshots.OpenFile(plugin, { file: new File([modelFile.data], modelFile.name)});
        const a = await _plugin.runTask(
          _plugin.state.data.applyAction(OpenFiles, {
            files: [asset],
            format: { name: "auto", params: {} },
            visuals: true,
          })
        )
      } else {
        const data = await _plugin.builders.data.download(
          { url: modelFile.url },
          { state: { isGhost: true } }
        )
        const asset = Asset.File(new File([data.obj.data], modelFile.name))
        _plugin.runTask(
          _plugin.state.data.applyAction(OpenFiles, {
            files: [asset],
            format: { name: "auto", params: {} },
            visuals: true,
          })
        )
      }

      // _plugin.managers.camera.resetAxes()
      // // _plugin.canvas3d.camera.resetAxes()
      // const snapshot = changeCameraRotation(
      //   _plugin.canvas3d.camera.getSnapshot(),
      //   ROTATION_MATRICES.rotY90
      // )
      // _plugin.managers.camera.setSnapshot(snapshot)
    }
  }
  return (
    <div
      style={{
        position: "absolute",
        width,
        height,
        overflow: "hidden",
        border: "0px",
      }}
    >
      <div
        ref={parentRef}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          border: "0px",
        }}
      />
    </div>
  )
}

Molstar.propTypes = {
  modelFile: PropTypes.object,
  trajFile: PropTypes.object,

  // Viz Control
  showAxes: PropTypes.bool,
  showControls: PropTypes.bool,
  showExpand: PropTypes.bool,
  showAnimation: PropTypes.bool,
  showSettings: PropTypes.bool,
  showSelectionMode: PropTypes.bool,
  showTrajectoryControls: PropTypes.bool,
  defaultShowControls: PropTypes.bool,

  // More
  width: PropTypes.string,
  height: PropTypes.string,

  preset_id: PropTypes.string,
  flag: PropTypes.bool,

  molscriptSelectionResidues: PropTypes.array,
  molscriptSelectionChains: PropTypes.string,
}

export default Molstar
