import { useState } from 'react'
import { Button, Field, Modal, inputCls } from '@/components/ui'
import { addAgent, SPECIALTIES, specialtyLabel, type AgentSpecialty } from '@/lib/agents'
import { t } from '@/lib/i18n'

/** Modal de criação de agente: configuração PRELIMINAR (sem execução de IA nesta fase). */
export function CreateAgentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [specialty, setSpecialty] = useState<AgentSpecialty>('finance')
  const [loaded, setLoaded] = useState(false)
  if (open && !loaded) {
    setLoaded(true)
    setName('')
    setDescription('')
    setSpecialty('finance')
  } else if (!open && loaded) {
    setLoaded(false)
  }

  const valid = name.trim().length > 0 && description.trim().length > 0

  const submit = () => {
    if (!valid) return
    addAgent({ name: name.trim(), description: description.trim(), specialty })
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={t('Criar agente', 'Create agent')}>
      <div className="space-y-3">
        <Field label={t('Nome', 'Name')}>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Ex.: Finance Agent', 'e.g. Finance Agent')} />
        </Field>
        <Field label={t('Descrição', 'Description')}>
          <textarea
            className={`${inputCls} min-h-24 resize-y py-2.5`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('O que este agente deve observar?', 'What should this agent monitor?')}
          />
        </Field>
        <Field label={t('Especialidade', 'Specialty')}>
          <select className={inputCls} value={specialty} onChange={(e) => setSpecialty(e.target.value as AgentSpecialty)}>
            {SPECIALTIES.map((s) => (
              <option key={s} value={s}>
                {specialtyLabel(s)}
              </option>
            ))}
          </select>
        </Field>
        <p className="rounded-xl bg-warn/10 p-3 text-xs text-warn text-pretty">
          {t(
            'Configuração preliminar: este agente é salvo localmente e não executa nenhuma ação de IA nesta fase.',
            'Preliminary configuration: this agent is saved locally and does not run any AI actions in this phase.',
          )}
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar', 'Cancel')}
          </Button>
          <Button disabled={!valid} onClick={submit}>
            {t('Criar', 'Create')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
