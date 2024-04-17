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
import { presetStaticComponent } from "@dp-launching/molstar/lib/mol-plugin-state/builder/structure/representation-preset"
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

import { StructureSelectionManager } from "@dp-launching/molstar/lib/mol-plugin-state/manager/structure/selection"

// import { getSelectionFromChainAuthId } from

const CustomMaterial = Material({ roughness: 0.2, metalness: 0 })
const PresetParams = {
  ...StructureRepresentationPresetProvider.CommonParams,
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

const InteractionsPreset = StructureRepresentationPresetProvider({
  id: "preset-interactions",
  display: { name: "Interactions" },
  params: () => PresetParams,
  async apply(ref, params, plugin) {
    const structureCell = StateObjectRef.resolveAndCheck(plugin.state.data, ref)
    const structure = structureCell?.obj?.data
    if (!structureCell || !structure) return {}

    const components = {
      ligand: await presetStaticComponent(plugin, structureCell, "all"),
      interactions: await presetStaticComponent(plugin, structureCell, "all"),
    }

    const { update, builder, typeParams } =
      StructureRepresentationPresetProvider.reprBuilder(plugin, params)
    const representations = {
      ligand: builder.buildRepresentation(
        update,
        components.ligand,
        {
          type: "ball-and-stick",
          typeParams: {
            ...typeParams,
            material: CustomMaterial,
            sizeFactor: 0.3,
          },
          color: "element-symbol",
          colorParams: { carbonColor: { name: "element-symbol", params: {} } },
        },
        { tag: "all" }
      ),
    }

    await update.commit({ revertOnError: true })
    plugin.managers.interactivity.setProps({ granularity: "element" })

    return { components, representations }
  },
})

const HotspotPreset = StructureRepresentationPresetProvider({
  id: "hotspot-preset",
  display: { name: "Hotspots" },
  params: () => PresetParams,
  async apply(ref, params, plugin) {
    const structureCell = StateObjectRef.resolveAndCheck(plugin.state.data, ref)
    const structure = structureCell?.obj?.data
    if (!structureCell || !structure) return {}

    const components = {
      ligand: await presetStaticComponent(plugin, structureCell, "all"),
      // interactions: await presetStaticComponent(plugin, structureCell, "all"),
    }

    const { update, builder, typeParams } =
      StructureRepresentationPresetProvider.reprBuilder(plugin, params)
    const representations = {
      ligand: builder.buildRepresentation(
        update,
        components.ligand,
        {
          type: "gaussian-surface",
          typeParams: { alpha: 1 },
          color: "uncertainty",
          colorParams: {
            value: 0.5,
            domain: [2.5, 6],
            list: {
              colors: [
                ColorNames.red,
                ColorNames.white, // Yellow at the middle value
                ColorNames.blue,
              ],
            }, // Blue at the highest value
          },
          // typeParams: {
          //   ...typeParams,
          //   material: CustomMaterial,
          //   sizeFactor: 0.3,
          // },
          // color: "uncertainty",
          // colorParams: { carbonColor: { name: "element-symbol", params: {} } },
        },
        { tag: "all" }
      ),
    }

    await update.commit({ revertOnError: true })
    plugin.managers.interactivity.setProps({ granularity: "element" })

    return { components, representations }
  },
})

const ViewerAutoPreset = StructureRepresentationPresetProvider({
  id: "preset-structure-representation-viewer-auto",
  display: {
    name: "Automatic (w/ Annotation)",
    group: "Annotation",
    description:
      "Show standard automatic representation but colored by quality assessment (if available in the model).",
  },
  isApplicable(a) {
    return (
      !!a.data.models.some((m) => QualityAssessment.isApplicable(m, "pLDDT")) ||
      !!a.data.models.some((m) => QualityAssessment.isApplicable(m, "qmean"))
    )
  },
  params: () => StructureRepresentationPresetProvider.CommonParams,
  async apply(ref, params, plugin) {
    const structureCell = StateObjectRef.resolveAndCheck(plugin.state.data, ref)
    const structure =
      structureCell && structureCell.obj && structureCell.obj.data
    const nmodels = structure.state.models[0].sourceData.data.structures
      ? structure.state.models[0].sourceData.data.structures.length
      : structure.state.models[0].modelNum
    if (nmodels > 1) {
      plugin.config.set("viewer.show-animation-button", true)
    } else {
      plugin.config.set("viewer.show-animation-button", false)
      plugin.managers.animation._animations.length = []
    }

    if (!structureCell || !structure) return {}

    if (structure.model.sourceData.kind === "gro") {
      return await InteractionsPreset.apply(ref, params, plugin)
    } else if (
      structure.models.some((m) => QualityAssessment.isApplicable(m, "pLDDT"))
    ) {
      return await QualityAssessmentPLDDTPreset.apply(ref, params, plugin)
    } else if (
      structure.models.some((m) => QualityAssessment.isApplicable(m, "qmean"))
    ) {
      return await QualityAssessmentQmeanPreset.apply(ref, params, plugin)
    } else {
      return await PresetStructureRepresentations.auto.apply(
        ref,
        params,
        plugin
      )
    }
  },
})

const Molstar = (props) => {
  const {
    modelFile,
    trajFile,
    height = "100%",
    width = "100%",
    showAxes = true,
    defaultShowControls = false,
    showExpand = true,
    showControls = true,
    showSettings = true,
    showSelectionMode = true,
    showAnimation = false,
    showTrajectoryControls = true,
    preset_id = "",
    flag = false,
  } = props
  const parentRef = useRef(null)
  const canvasRef = useRef(null)
  const plugin = useRef(null)

  const [initialized, setInitialized] = useState(false)

  const MySpec = {
    ...DefaultPluginUISpec(),
    config: [
      [PluginConfig.Viewport.ShowExpand, showExpand],
      [PluginConfig.Viewport.ShowControls, showControls],
      [PluginConfig.Viewport.ShowSettings, showSettings],
      [PluginConfig.Viewport.ShowSelectionMode, showSelectionMode],
      [PluginConfig.Viewport.ShowAnimation, true],
      [PluginConfig.Structure.DefaultRepresentationPreset, preset_id],
      [PluginConfig.Viewport.ShowTrajectoryControls, showTrajectoryControls],
    ],
    layout: {
      initial: {
        isExpanded: false,
        controlsDisplay: "reactive",
        showControls: defaultShowControls,
      },
    },
  }
  function get_spec() {
    const spec = DefaultPluginUISpec()
    spec.layout = {
      initial: {
        isExpanded: false,
        controlsDisplay: "reactive",
        showControls: defaultShowControls,
      },
    }
    const preset = flag ? ViewerAutoPreset.id : ViewerAutoPreset.id //InteractionsPreset.id
    spec.config = [
      [PluginConfig.Viewport.ShowExpand, showExpand],
      [PluginConfig.Viewport.ShowControls, showControls],
      [PluginConfig.Viewport.ShowSettings, showSettings],
      [PluginConfig.Viewport.ShowSelectionMode, showSelectionMode],
      [PluginConfig.Viewport.ShowAnimation, true],
      [
        PluginConfig.Structure.DefaultRepresentationPreset,
        InteractionsPreset.id,
      ],
      [PluginConfig.Viewport.ShowTrajectoryControls, showTrajectoryControls],
    ]
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
    const query = MS.struct.generator.atomGroups({
      "chain-test": MS.core.rel.eq([
        MS.struct.atomProperty.macromolecular.label_asym_id(),
        chainId,
      ]),
      "residue-test": MS.core.set.has([
        MS.set(...positions),
        MS.struct.atomProperty.macromolecular.auth_seq_id(),
      ]),
      "group-by": MS.struct.atomProperty.macromolecular.residueKey(),
    })
    return Script.getStructureSelection(
      query,
      plugin.current.managers.structure.hierarchy.current.structures[0].cell.obj
        ?.data
    )
  }

  async function get_current() {
    if (plugin && plugin.current) {
      const current = await plugin.current.managers.structure.hierarchy.current
      return current
    }
    return
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
            ViewerAutoPreset
          )
          plugin.builders.structure.representation.registerPreset(
            InteractionsPreset
          )
          plugin.builders.structure.representation.registerPreset(HotspotPreset)
        },
      })
      if (true) {
        // eslint-disable-next-line
        await plugin.current.canvas3d?.setProps({
          // color: ColorNames.red,
          camera: {
            helper: {
              axes: {
                name: "off",
                params: {},
              },
            },
          },
          backgroundColor: ColorNames.pink, // or: 0xff0000 as Color
        })
      }
      await loadStructure(modelFile, trajFile, plugin.current)
    }
    init()
    const disposePlugin = () => {
      if (plugin.current) {
        plugin.current.dispose()
        plugin.current = null
      }
    }
    // return disposePlugin
  }, [])

  useEffect(() => {
    async function update() {
      if (!plugin || !plugin.current) {
        return
      }
      console.log("update!")

      // const curr = await get_current()
      const hierarchy = await plugin.current.managers.structure.hierarchy
        .current //
      const refs = hierarchy.refs
      const structures = await plugin.current.managers.structure.component
        .currentStructures
      const components = structures[0].components
      const component = components[0]
      // const structures = hierarchy.structures
      const a = new StructureComponentManager(plugin.current)
      console.log(hierarchy)
      console.log(structures)

      await a.applyPreset(
        plugin.current.managers.structure.hierarchy.selection.structures,
        HotspotPreset
      )

      // const params = {
      // color: 'uncertainty',
      // colorParams: {
      //   value: 0.5,
      //   domain: [2.5, 6],
      //   list: {
      //     colors: [
      //       ColorNames.red,
      //       ColorNames.white, // Yellow at the middle value
      //       ColorNames.blue,
      //     ],
      //   }, // Blue at the highest value)
      // }
      // }
      // let params = undefined
      // plugin.current.dataTransaction(
      //   async () => {
      //     for (const c of components)
      //       await a.updateRepresentationsTheme(c, { color: "uncertainty" })
      //   },
      //   { canUndo: "Update Theme" }
      // )
      // await a.updateRepresentationsTheme(components, { color: "uncertainty" })
      // const update = plugin.current.build()
      // const builder = plugin.current.builders.structure.representation
      // console.log(components)
      // const representations = {
      //   polymer: builder.buildRepresentation(update, components.polymer, {
      //     type: "gaussian-surface",
      //     typeParams: { alpha: 1 },
      //     color: "uncertainty",
      //     colorParams: {
      //       value: 0.5,
      //       domain: [2.5, 6],
      //       list: {
      //         colors: [
      //           ColorNames.red,
      //           ColorNames.white, // Yellow at the middle value
      //           ColorNames.blue,
      //         ],
      //       }, // Blue at the highest value
      //     },
      //   }),
      // }
      // await update.commit({ revertOnError: true })
      const repr = structures[0]
      // console.log(repr.cell)
      // console.log(await plugin.current.build().to(repr.cell))
      // console.log(
      //   await plugin.current
      //     .build()
      //     .to(repr.cell)
      //     .update(
      //       createStructureRepresentationParams(plugin.current, repr.cell, {
      //         type: "ball-and-stick",
      //         typeParams: { aromaticBonds: true },
      //       })
      //     )
      //     // .commit()
      // )
      // await plugin.current
      //   .build()
      //   .to(repr.cell)
      //   .update(
      //     createStructureRepresentationParams(plugin.current, repr.cell, {
      //       type: "ball-and-stick",
      //       typeParams: { aromaticBonds: true },
      //     })
      //   )
      //   .commit()
      // createStructureRepresentationParams(plugin.current, void 0, {})
      // plugin.current.managers.interactivity.setProps({ granularity: "element" })

      // plugin.current.dataTransaction(
      //   async () => {
      //     await plugin.current
      //       .build()
      //       .to(repr.cell)
      //       .update(prev => {
      //         prev.params = createStructureRepresentationParams(
      //           plugin.current,
      //           repr,
      //           {
      //             type: "ball-and-stick",
      //             typeParams: { aromaticBonds: true },
      //           }
      //         )
      //       })
      //       .commit()
      // for (const s of plugin.current.managers.structure.hierarchy.selection
      //   .structures)
      // await a.addRepresentation(components, "ligand")
      // await a.updateRepresentationsTheme(components, {
      //   // type: "gaussian-surface",
      //   // typeParams: { alpha: 1 },
      //   color: "uncertainty",
      //   colorParams: {
      //     value: 0.5,
      //     domain: [2.5, 6],
      //     list: {
      //       colors: [
      //         ColorNames.red,
      //         ColorNames.white, // Yellow at the middle value
      //         ColorNames.blue,
      //       ],
      //     }, // Blue at the highest value)
      //   },
      // })

      // const query = compileIdListSelection("D 306-311", "auth")
      // plugin.current.managers.structure.selection.fromCompiledQuery(
      //   "add",
      //   query
      // )
      // console.log(plugin.current.managers.structure.selection.getSnapshot())

      // console.log(
      //   plugin.current.managers.structure.selection.fromSelectionQuery(
      //     "set",
      //     query
      //   )
      // )
      console.log("yooo!")
      console.log(structures[0])
      const s = structures[0]
      // const s = Structure(structures[0])
      console.log(s)
      // console.log(structures[0])
      const Q = MolScriptBuilder
      // var sel = Script.getStructureSelection(
      //   (Q) =>
      //     Q.struct.generator.atomGroups({
      //       "chain-test": Q.core.rel.eq([
      //         Q.struct.atomProperty.macromolecular.auth_asym_id(),
      //         "A",
      //       ]),
      //       "residue-test": Q.core.rel.eq([
      //         Q.struct.atomProperty.macromolecular.label_seq_id(),
      //         306,
      //       ]),
      //     }),
      //   s
      // )
      // console.log(sel)

      // let loci = StructureSelection.toLociWithSourceUnits(sel)

      const query2 = compileIdListSelection("A 306-311", "auth")
      // const b2 = plugin.current.managers.structure.selection.fromCompiledQuery(
      //   "add",
      //   query
      // )

      // console.log(plugin.current.managers.structure.hierarchy)

      // const ligandData =
      //   plugin.current.managers.structure.hierarchy.selection.structures[0]
      //     ?.components[0]?.cell.obj?.data

      // const selection = StructureSelection.toLociWithCurrentUnits(
      //   Script.getStructureSelection("C 306-311", structures[0])
      // )
      // console.log(selection)
      // console.log(ligandData)

      // const ligandLoci = Structure.toStructureElementLoci(ligandData)

      // plugin.current.managers.camera.focusLoci(ligandLoci)
      // plugin.current.managers.interactivity.lociSelects.select({
      //   loci: ligandLoci,
      // })

      // console.log(
      //   plugin.current.managers.structure.hierarchy.selection.structures.current
      // )
      console.log("hello!")

      // getSelectionFromChainAuthId()

      // const selection = Script.getStructureSelection(
      //   (Q) =>
      //     Q.struct.generator.atomGroups({
      //       "chain-test": Q.core.rel.eq([Q.ammp("label_asym_id"), "C"]),
      //       "residue-test": Q.core.rel.eq([Q.ammp("label_seq_id"), xx]),
      //     }),
      //   // plugin.current.managers.structure.hierarchy.selection.structures
      //   structures[0]?.components[0]?.cell.obj?.data
      // )
      // console.log(selection)
      const selection = getSelectionFromChainAuthId(
        "C",
        [306, 307, 308, 309, 310, 311]
      )

      const loci = StructureSelection.toLociWithSourceUnits(selection)
      console.log("dsakjflaksdj")
      console.log(loci)

      // plugin.current.managers.camera.focusLoci(loci)
      console.log(plugin.current.managers.interactivity)
      // plugin.current.managers.interactivity.lociHighlights.highlightOnly({ loci })
      plugin.current.managers.interactivity.lociSelects.select({
        loci: loci,
      })
      // await plugin.current.canvas3d?.setProps({
      //   // color: ColorNames.red,
      //   camera: {
      //     helper: {
      //       axes: {
      //         name: "off",
      //         params: {},
      //       },
      //     },
      //   },
      //   // backgroundColor: ColorNames.pink, // or: 0xff0000 as Color
      // })
      //   },
      //   { canUndo: "Update Theme" }
      // )
      // plugin.current.state.data
      //   .build()
      //   .to(repr.cell)
      //   .update(
      //     createStructureRepresentationParams(
      //       plugin.current,
      //       components[0].cell.obj?.data,
      //       {
      //         type: "ball-and-stick",
      //         typeParams: { aromaticBonds: true },
      //       }
      //     )
      //   )
      //   .commit()

      // console.log(a.currentStructures)
      // console.log(refs)
      // console.log(hierarchy.)
    }

    async function test() {
      if (!plugin || !plugin.current) {
        return
      }
      const structures = await plugin.current.managers.structure.component
        .currentStructures

      for (const s of structures) {
        for (const c of s.components) {
          for (const repr of c.representations) {
            console.log(repr)
            plugin.current
              .build()
              .to(repr.cell)
              .update(
                createStructureRepresentationParams(plugin.current, repr.cell, {
                  type: "ball-and-stick",
                  typeParams: { aromaticBonds: true },
                })
              )
              .commit()
          }
        }
      }

      if (!plugin.current.canvas3d) return
      const trackball = plugin.current.canvas3d.props.trackball
      PluginCommands.Canvas3D.SetSettings(plugin.current, {
        settings: {
          trackball: {
            ...trackball,
            animate:
              trackball.animate.name === "spin"
                ? { name: "off", params: {} }
                : { name: "spin", params: { speed: 1 } },
          },
        },
      })
    }

    if (flag) {
      update()
    } else {
      test()
    }
    // test()
    // const disposePlugin = () => {
    //   if (plugin.current) {
    //     plugin.current.dispose()
    //     plugin.current = null
    //   }
    // }
    // return disposePlugin
    // return
  }, [flag])

  // useEffect(() => {

  // })

  // useEffect(() => {
  //   console.log('Model or trajectory file changed.')
  //   console.log(trajFile)
  //   console.log(modelFile)
  //   loadStructure(modelFile, trajFile, plugin.current)
  // }, [modelFile, trajFile])

  // useEffect(() => {
  //   if (plugin.current) {
  //     if (!showAxes) {
  //       // eslint-disable-next-line
  //       plugin.current.canvas3d?.setProps({
  //         camera: {
  //           helper: {
  //             axes: {
  //               name: "off",
  //               params: {},
  //             },
  //           },
  //         },
  //       })
  //     } else {
  //       // eslint-disable-next-line
  //       plugin.current.canvas3d?.setProps({
  //         camera: {
  //           helper: {
  //             axes: ParamDefinition.getDefaultValues(CameraHelperParams).axes,
  //           },
  //         },
  //       })
  //     }
  //   }
  // }, [showAxes])

  // useEffect(() => {
  //   async function update() {
  //     console.log(flag)
  //     console.log('hello~')
  //     // const update = plugin.build()
  //     // const builder = plugin.builders.structure.representation
  //     // const representations = {
  //     //   polymer: builder.buildRepresentation(update, components.polymer, {
  //     //     type: "gaussian-surface",
  //     //     typeParams: { alpha: 1 },
  //     //     color: "uncertainty",
  //     //     colorParams: {
  //     //       value: 0.5,
  //     //       domain: [2.5, 6],
  //     //       list: {
  //     //         colors: [
  //     //           ColorNames.red,
  //     //           ColorNames.white, // Yellow at the middle value
  //     //           ColorNames.blue,
  //     //         ],
  //     //       }, // Blue at the highest value
  //     //     },
  //     //   }),
  //     // }
  //     // await update.commit({ revertOnError: true })
  //     // plugin.managers.interactivity.setProps({ granularity: "element" })
  //   }
  //   update()
  //   const disposePlugin = () => {
  //     if (plugin.current) {
  //       plugin.current.dispose()
  //       plugin.current = null
  //     }
  //   }
  //   return disposePlugin
  // }, [flag])

  // async function get_current() {
  //   if (plugin & plugin.current) {
  //     const current = await plugin.current.managers.structure.hierarchy.current
  //     return current
  //   }
  //   return
  // }

  // useEffect(() => {
  //   async function update() {
  //     if (plugin && plugin.current) {
  //       console.log("update!")
  //       console.log(flag)
  //       const update = plugin.current.build()
  //       const builder = plugin.current.builders.structure.representation

  //       const renderer = plugin.current.canvas3d?.props.renderer
  //       if (renderer) {
  //         PluginCommands.Canvas3D.SetSettings(plugin.current, {
  //           settings: {
  //             renderer: {
  //               ...renderer,
  //               backgroundColor: ColorNames.pink, // or: 0xff0000 as Color
  //             },
  //           },
  //         })
  //       }
  //       console.log(renderer)

  //       // console.log("structure")
  //       console.log("current plugin:", plugin.current)
  //       console.log("plugin.build():", plugin.current.build())

  //       const curr = await plugin.current.managers.structure.hierarchy.current
  //       console.log("xfdsfa sd", curr)

  //       const reprs = curr.structures
  //       const trajs = curr.trajectories
  //       const models = curr.models
  //       const refs = curr.refs
  //       // const
  //       console.log("reprs:", reprs)
  //       console.log("trajs: ", trajs)

  //       console.log("refs:", refs)

  //       console.log('test:', await plugin.current.managers.structure)

  //       // const structureCell = StateObjectRef.resolveAndCheck(
  //       //   plugin.current.state.data,
  //       //   // plugin.current
  //       //   undefined
  //       // )
  //       // console.log(structureCell)
  //       // const update = plugin.current.build()

  //       // get list of all structures

  //       // const reprs = await plugin.current.managers.structure.hierarchy.current
  //       //   .structures
  //       // const hierarchy = await plugin.current.managers.structure.hierarchy.updateStructure(reprs[0])
  //       // console.log(hierarchy)

  //       const repr = reprs[0]
  //       console.log(repr.cell)
  //       await plugin.current
  //         .build()
  //         .to(repr.cell)
  //         .update(
  //           // StateTransforms.Representation.StructureRepresentation3D,
  //           // (old) => {
  //           //   old.type.params.aromaticBonds = true
  //           // }
  //           createStructureRepresentationParams(plugin.current, void 0, {
  //             type: "ball-and-stick",
  //             typeParams: { aromaticBonds: true },
  //           })
  //         ).commit()

  //       // const a = await plugin.current.managers
  //       // console.log(a)

  //       // console.log("...")
  //       // console.log(reprs)
  //       // for (const repr of reprs) {
  //       //   console.log(repr)
  //       //   console.log(update)
  //       //   console.log(repr.cell)
  //       //   console.log(update.to(repr.cell))

  //       //   const components = {
  //       //     polymer: await presetStaticComponent(
  //       //       plugin.current,
  //       //       repr.cell,
  //       //       "polymer"
  //       //     ),
  //       //   }
  //       //   // const components = {
  //       //   //   polymer: undefined
  //       //   // }
  //       //   // const update = plugin.build()
  //       //   // const builder = plugin.current.builders.structure.representation
  //       //   console.log(flag)
  //       //   console.log(flag ? "gaussian-surface" : "ball-and-stick")
  //       //   // plugin.current.clear()
  //       //   const representations = {
  //       //     polymer: await builder.buildRepresentation(
  //       //       update,
  //       //       components.polymer,
  //       //       {
  //       //         type: flag ? "gaussian-surface" : "ball-and-stick",
  //       //         typeParams: { alpha: 1 },
  //       //         color: "uncertainty",
  //       //         colorParams: {
  //       //           value: 0.5,
  //       //           domain: [2.5, 6],
  //       //           list: {
  //       //             colors: [
  //       //               ColorNames.red,
  //       //               ColorNames.white, // Yellow at the middle value
  //       //               ColorNames.blue,
  //       //             ],
  //       //           }, // Blue at the highest value
  //       //         },
  //       //       }
  //       //     ),
  //       //   }

  //       //   // plugin.current.clear()
  //       //   await update.commit({ revertOnError: true })

  //       //   console.log("hello?")
  //       // }
  //       // console.log(
  //       //   plugin.current
  //       //     .build()

  //       // )
  //       // console.log(structure)

  //       // const renderer = plugin.current.canvas3d!.props.renderer;
  //       // PluginCommands.Canvas3D.SetSettings(plugin.current, { settings: { renderer: { ...renderer, backgroundColor: ColorNames.red /* or: 0xff0000 as Color */ } } });
  //       // await canvasRef.applySettings({ color: ColorNames.blue })
  //       // const components = {
  //       //   ligand: await presetStaticComponent(plugin, structureCell, "all"),
  //       //   interactions: await presetStaticComponent(
  //       //     plugin,
  //       //     structureCell,
  //       //     "all"
  //       //   ),
  //       // }

  //       // const representations = {
  //       //   polymer: builder.buildRepresentation(update, components.polymer, )
  //       // }
  //       // console.log(update)
  //       // console.log(builder)
  //       // console.log(components)
  //     }
  //   }
  //   update()
  //   // const disposePlugin = () => {
  //   //   if (plugin.current) {
  //   //     plugin.current.dispose()
  //   //     plugin.current = null
  //   //   }
  //   // }
  //   // return disposePlugin
  // }, [flag])

  const loadStructure = async (modelFile, trajFile, _plugin) => {
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
    }
  }
  return (
    <div style={{ position: "absolute", width, height, overflow: "hidden" }}>
      <div
        ref={parentRef}
        style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}
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
}

export default Molstar
