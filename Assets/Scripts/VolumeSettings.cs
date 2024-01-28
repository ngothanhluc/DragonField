using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Audio;
using UnityEngine.UI;

public class VolumeSettings : MonoBehaviour
{
    [SerializeField]
    private AudioMixer audioMixer;
    [SerializeField]
    private Slider volumeSlider;

    public void SetVolume()
    {
        float volume = volumeSlider.value;
        audioMixer.SetFloat("vol", Mathf.Log10(volume) * 20);
    }
}
