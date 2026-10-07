import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import types
import numpy as np
spec=importlib.util.spec_from_file_location('adapter',Path(__file__).resolve().parents[1]/'scripts/native_analysis.py')
adapter=importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
class AdapterTests(unittest.TestCase):
    def test_session_uses_bound_model_and_reuses_session(self):
        paths=[]
        fake=types.SimpleNamespace(SessionOptions=lambda:types.SimpleNamespace(),InferenceSession=lambda path,**kwargs:paths.append(path) or object())
        adapter.SESSIONS.clear()
        with patch.dict('sys.modules',{'onnxruntime':fake}),patch.dict('os.environ',{'JIANPU_BASIC_MODEL':'D:/external/models/nmp.onnx'}):
            self.assertIs(adapter.session('cpu'),adapter.session('cpu'))
        self.assertEqual(paths,['D:/external/models/nmp.onnx'])
        adapter.SESSIONS.clear()
    def test_padding_and_window_boundaries(self):
        audio=np.arange(44100,dtype=np.float32)
        blocks=list(adapter.windows(audio))
        self.assertEqual(len(blocks),2)
        self.assertEqual(blocks[0].shape,(43844,1))
        np.testing.assert_array_equal(blocks[0][:3840,0],0)
        self.assertEqual(blocks[0][3840,0],0)
        self.assertEqual(blocks[1][0,0],36164-3840)
        self.assertEqual(blocks[-1][-1,0],0)
    def test_oom_reduces_batch_and_keeps_finished_outputs(self):
        calls=[]
        def infer(blocks,device):
            calls.append((len(blocks),device))
            if device=='cuda' and len(blocks)>1:raise RuntimeError('out of memory')
            return blocks,blocks
        blocks=[np.array([i]) for i in range(6)]
        result,device,batch,reasons=adapter.infer_blocks(blocks,'cuda',4,infer)
        self.assertEqual([int(pair[0][0]) for pair in result],list(range(6)))
        self.assertEqual(calls[:3],[(4,'cuda'),(2,'cuda'),(1,'cuda')])
        self.assertEqual(device,'cuda')
    def test_gpu_failure_retries_only_failed_group_on_cpu(self):
        calls=[]
        def infer(blocks,device):
            calls.append((int(blocks[0][0]),device))
            if device=='cuda' and int(blocks[0][0])>=4:raise RuntimeError('device lost')
            return blocks,blocks
        result,device,batch,reasons=adapter.infer_blocks([np.array([i]) for i in range(6)],'cuda',4,infer)
        self.assertEqual(device,'cpu')
        self.assertEqual([int(pair[0][0]) for pair in result],list(range(6)))
        self.assertEqual(calls[0],(0,'cuda'))
        self.assertNotIn((0,'cpu'),calls)
if __name__=='__main__':unittest.main()
