import {
  GherkinStreams,
  IGherkinStreamOptions,
} from '@cucumber/gherkin-streams'
import {
  Envelope,
  GherkinDocument,
  IdGenerator,
  Location,
  ParseError,
  Pickle,
} from '@cucumber/messages'
import { Query as GherkinQuery } from '@cucumber/gherkin-utils'
import PickleFilter from '../pickle_filter'
import { orderPickles } from '../cli/helpers'
import { ISourcesCoordinates } from './types'
import _ from 'lodash'
import axios from 'axios'

interface PickleWithDocument {
  gherkinDocument: GherkinDocument
  location: Location
  pickle: Pickle
}

export async function getFilteredPicklesAndErrors({
  newId,
  cwd,
  logger,
  unexpandedFeaturePaths,
  featurePaths,
  coordinates,
  onEnvelope,
}: {
  newId: IdGenerator.NewId
  cwd: string
  logger: Console
  unexpandedFeaturePaths: string[]
  featurePaths: string[]
  coordinates: ISourcesCoordinates
  onEnvelope?: (envelope: Envelope) => void
}): Promise<{
  filteredPickles: PickleWithDocument[]
  parseErrors: ParseError[]
}> {
  const gherkinQuery = new GherkinQuery()
  const parseErrors: ParseError[] = []
  await gherkinFromPaths(
    featurePaths,
    {
      newId,
      relativeTo: cwd,
      defaultDialect: coordinates.defaultDialect,
    },
    (envelope) => {
      gherkinQuery.update(envelope)
      if (envelope.parseError) {
        parseErrors.push(envelope.parseError)
      }
      onEnvelope?.(envelope)
    }
  )
  const pickleFilter = new PickleFilter({
    cwd,
    featurePaths: unexpandedFeaturePaths,
    names: coordinates.names,
    tagExpression: coordinates.tagExpression,
  })
  const filteredPickles: PickleWithDocument[] = gherkinQuery
    .getPickles()
    .filter((pickle) => {
      const gherkinDocument = gherkinQuery
        .getGherkinDocuments()
        .find((doc) => doc.uri === pickle.uri)
      return pickleFilter.matches({ gherkinDocument, pickle })
    })
    .map((pickle) => {
      const gherkinDocument = gherkinQuery
        .getGherkinDocuments()
        .find((doc) => doc.uri === pickle.uri)
      const location = gherkinQuery.getLocation(
        pickle.astNodeIds[pickle.astNodeIds.length - 1]
      )
      return {
        gherkinDocument,
        location,
        pickle,
      }
    })
  orderPickles(filteredPickles, coordinates.order, logger)




  //AutomationHub Helping functions and code
  const filteredPicklesLocal = filteredPickles;
  if (process.env.AUTOMATION_HUB == 'true' && process.env.RETRY_RUN == 'true') {
    const queryPassed = { buildForReleaseId: process.env.BUILDRELEASE_ID, 'runs.status': { $in: ['PASSED'] } };
    let passedScenarios = [];
    try {
      const automationstatusResponse = await axios.post('/automationstatus/query', queryPassed);
      passedScenarios = automationstatusResponse.data;
    } catch (error) {
      console.log('/automationstatus/query API call failed in Gherkin document', error);
      passedScenarios = [];
    }
    passedScenarios.forEach((element: any, index: number) => {
      _.remove(filteredPicklesLocal, (o) => o.pickle.name == element.scenario);
    });
  }
  /** END of AutomationHub Help Code **/

  return {
    filteredPickles:filteredPicklesLocal,
    parseErrors,
  }
}

async function gherkinFromPaths(
  paths: string[],
  options: IGherkinStreamOptions,
  onEnvelope: (envelope: Envelope) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const gherkinMessageStream = GherkinStreams.fromPaths(paths, options)
    gherkinMessageStream.on('data', onEnvelope)
    gherkinMessageStream.on('end', resolve)
    gherkinMessageStream.on('error', reject)
  })
}
