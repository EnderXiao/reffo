import {StyleSheet} from 'react-native'
import {createLineHeight} from './utils/createLineHeight'

export const styles = StyleSheet.create({
  page: {
    flex: 1,
    flexDirection: 'column',
  },
  container: {
    flex: 1,
    flexDirection: 'column',
    position: 'relative',
    backgroundColor: '#ffffff',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  contentShell: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    minHeight: 0,
    position: 'relative',
    zIndex: 1,
  },
  contentFrame: {
    flex: 1,
    flexDirection: 'column',
    width: '100%',
    maxWidth: 393,
    paddingLeft: 24,
    paddingRight: 24,
    minHeight: 0,
  },
  contentFrameCompact: {
    paddingLeft: 13,
    paddingRight: 13,
  },
  chromeRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 18,
  },
  chromeRowCompact: {
    marginBottom: 2,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(221, 228, 240, 0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#8ca0be',
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 3,
  },
  closeButtonText: {
    color: '#cfd4de',
    fontSize: 18,
    lineHeight: createLineHeight(18),
    fontWeight: '700',
  },
  scrollArea: {
    flex: 1,
    width: '100%',
    minHeight: 0,
  },
  scrollAreaCompact: {
    minHeight: 0,
  },
  scrollContent: {
    flexGrow: 1,
    flexDirection: 'column',
    paddingBottom: 14,
  },
  scrollContentCompact: {
    paddingBottom: 8,
  },
  staticContentArea: {
    flex: 1,
    flexDirection: 'column',
    minHeight: 0,
  },
  staticContentAreaCompact: {
    minHeight: 0,
  },
  staticContentBody: {
    flex: 1,
    flexDirection: 'column',
    minHeight: 0,
  },
  staticContentBodyCompact: {
    minHeight: 0,
  },
  staticHeroSlot: {
    flexShrink: 0,
  },
  staticStepSlot: {
    flex: 1,
    minHeight: 0,
  },
  heroBlock: {
    marginBottom: 24,
  },
  heroBlockCompact: {
    marginBottom: 10,
  },
  titleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    marginBottom: 8,
  },
  titleSegment: {
    marginRight: 2,
    color: '#22201f',
    fontSize: 28,
    lineHeight: createLineHeight(36),
    fontWeight: '600',
  },
  titleSegmentCompact: {
    fontSize: 24,
    lineHeight: createLineHeight(31),
  },
  titleSegmentAccent: {
    color: '#135fdb',
    fontWeight: '700',
  },
  titleSegmentWarm: {
    color: '#ef7a4c',
    fontWeight: '700',
  },
  description: {
    color: '#a7adba',
    fontSize: 14,
    lineHeight: createLineHeight(22),
  },
  descriptionCompact: {
    fontSize: 11.5,
    lineHeight: createLineHeight(17),
  },
  footer: {
    paddingTop: 16,
    paddingBottom: 4,
    alignItems: 'center',
  },
  footerCompact: {
    paddingTop: 2,
    paddingBottom: 0,
    paddingLeft: 18,
    alignItems: 'flex-start',
  },
  primaryButton: {
    width: 244,
    minHeight: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: {width: 0, height: 10},
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 4,
  },
  primaryButtonCompact: {
    width: 188,
    minHeight: 42,
    borderRadius: 21,
  },
  primaryButtonCool: {
    backgroundColor: '#1677ff',
    shadowColor: '#9aa7bb',
  },
  primaryButtonDark: {
    backgroundColor: '#1d3557',
    shadowColor: '#7f8fa8',
  },
  primaryButtonWarm: {
    backgroundColor: '#ff6a43',
    shadowColor: '#efb08c',
  },
  primaryButtonDisabled: {
    backgroundColor: '#cfd1d4',
    shadowOpacity: 0,
    elevation: 0,
  },
  primaryButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonSparkle: {
    marginRight: 8,
    color: '#ffffff',
    fontSize: 16,
    lineHeight: createLineHeight(18),
    fontWeight: '700',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 18,
    lineHeight: createLineHeight(24),
    fontWeight: '700',
  },
  primaryButtonTextCompact: {
    fontSize: 15,
    lineHeight: createLineHeight(18),
  },
  emptySummaryCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d9e2f0',
    backgroundColor: 'rgba(244, 249, 255, 0.9)',
    paddingTop: 18,
    paddingRight: 16,
    paddingBottom: 18,
    paddingLeft: 16,
  },
  emptySummaryTitle: {
    color: '#334155',
    fontSize: 16,
    lineHeight: createLineHeight(24),
    fontWeight: '700',
  },
  emptySummaryText: {
    marginTop: 4,
    color: '#7f8fa8',
    fontSize: 13,
    lineHeight: createLineHeight(19),
  },
})
