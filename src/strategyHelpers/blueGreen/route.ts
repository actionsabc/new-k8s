import {sleep} from '../../utilities/timeUtils'
import {RouteStrategy} from '../../types/routeStrategy'
import {Kubectl} from '../../types/kubectl'
import {
   BlueGreenDeployment,
   BlueGreenManifests
} from '../../types/blueGreenTypes'
import {
   getManifestObjects,
   GREEN_LABEL_VALUE,
   deployObjects
} from './blueGreenHelper'

import {
   getUpdatedBlueGreenIngress,
   isIngressRouted
} from './ingressBlueGreenHelper'
import {getUpdatedBlueGreenService} from './serviceBlueGreenHelper'
import {createTrafficSplitObject} from './smiBlueGreenHelper'

import * as core from '@actions/core'
import {K8sObject, TrafficSplitObject} from '../../types/k8sObject'
import {getBufferTime} from '../../inputUtils'

export async function routeBlueGreenForDeploy(
   kubectl: Kubectl,
   inputManifestFiles: string[],
   routeStrategy: RouteStrategy
): Promise<BlueGreenDeployment> {
   // sleep for buffer time
   const bufferTime: number = getBufferTime()
   const startSleepDate = new Date()
   core.info(
      `Starting buffer time of ${bufferTime} minute(s) at ${startSleepDate.toISOString()}`
   )
   await sleep(bufferTime * 1000 * 60)
   const endSleepDate = new Date()
   core.info(
      `Stopping buffer time of ${bufferTime} minute(s) at ${endSleepDate.toISOString()}`
   )

   const manifestObjects: BlueGreenManifests =
      getManifestObjects(inputManifestFiles)

   // route to new deployments
   if (routeStrategy == RouteStrategy.INGRESS) {
      return await routeBlueGreenIngress(
         kubectl,
         manifestObjects.serviceNameMap,
         manifestObjects.ingressEntityList
      )
   } else if (routeStrategy == RouteStrategy.SMI) {
      return await routeBlueGreenSMI(
         kubectl,
         GREEN_LABEL_VALUE,
         manifestObjects.serviceEntityList
      )
   } else {
      return await routeBlueGreenService(
         kubectl,
         GREEN_LABEL_VALUE,
         manifestObjects.serviceEntityList
      )
   }
}

export async function routeBlueGreenIngress(
   kubectl: Kubectl,
   serviceNameMap: Map<string, string>,
   ingressEntityList: any[]
): Promise<BlueGreenDeployment> {
   // const newObjectsList = []
   const newObjectsList: K8sObject[] = ingressEntityList.map((obj) => {
      if (isIngressRouted(obj, serviceNameMap)) {
         const newBlueGreenIngressObject = getUpdatedBlueGreenIngress(
            obj,
            serviceNameMap,
            GREEN_LABEL_VALUE
         )
         return newBlueGreenIngressObject
      } else {
         core.debug(`unrouted ingress detected ${obj.metadata.name}`)
         return obj
      }
   })

   const deployResult = await deployObjects(kubectl, newObjectsList)

   return {deployResult, objects: newObjectsList}
}

export async function routeBlueGreenIngressUnchanged(
   kubectl: Kubectl,
   serviceNameMap: Map<string, string>,
   ingressEntityList: any[]
): Promise<BlueGreenDeployment> {
   const objects = ingressEntityList.filter((ingress) =>
      isIngressRouted(ingress, serviceNameMap)
   )

   const deployResult = await deployObjects(kubectl, objects)
   return {deployResult, objects}
}

export async function routeBlueGreenService(
   kubectl: Kubectl,
   nextLabel: string,
   serviceEntityList: any[]
): Promise<BlueGreenDeployment> {
   const objects = serviceEntityList.map((serviceObject) =>
      getUpdatedBlueGreenService(serviceObject, nextLabel)
   )

   const deployResult = await deployObjects(kubectl, objects)

   return {deployResult, objects}
}

export async function routeBlueGreenSMI(
   kubectl: Kubectl,
   nextLabel: string,
   serviceEntityList: any[]
): Promise<BlueGreenDeployment> {
   // let tsObjects: TrafficSplitObject[] = []

   const tsObjects: TrafficSplitObject[] = await Promise.all(
      serviceEntityList.map(async (serviceObject) => {
         const tsObject: TrafficSplitObject = await createTrafficSplitObject(
            kubectl,
            serviceObject.metadata.name,
            nextLabel
         )

         return tsObject
      })
   )

   const deployResult = await deployObjects(kubectl, tsObjects)

   return {deployResult, objects: tsObjects}
}
